import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RoleRow = { role: string | null };

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDateOnlyUtc(d: Date) {
  return d.toISOString().slice(0, 10);
}

function currentTargetDate(now = new Date()) {
  const todayUtc = startOfUtcDay(now);
  return toDateOnlyUtc(addUtcDays(todayUtc, 1));
}

function getTreasuryWallet() {
  const wallet =
    process.env.TREASURY_WALLET ||
    process.env.NEXT_PUBLIC_TREASURY_WALLET ||
    "";

  if (!wallet.trim()) {
    throw new Error("Server missing TREASURY_WALLET / NEXT_PUBLIC_TREASURY_WALLET");
  }

  return wallet.trim();
}

async function getViewerWallet() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

async function requireDev(wallet: string) {
  const sb = supabaseAdmin();

  const prof = await sb.from("dev_profiles").select("wallet").eq("wallet", wallet).maybeSingle();
  if (!prof.error && prof.data?.wallet) return true;

  const { data: user } = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle<RoleRow>();
  const role = (user?.role ?? null) as string | null;
  return role === "dev" || role === "admin";
}

async function getAuction(targetDate: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_auctions")
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getQueueRowForWallet(auctionId: string, wallet: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_payment_queue")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, bidder_wallet, amount_lamports, priority_rank, status, payment_due_at, paid_at, skipped_at, created_at, updated_at"
    )
    .eq("auction_id", auctionId)
    .eq("bidder_wallet", wallet)
    .order("priority_rank", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getCurrentAwaitingPaymentRow(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_payment_queue")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, bidder_wallet, amount_lamports, priority_rank, status, payment_due_at, paid_at, skipped_at, created_at, updated_at"
    )
    .eq("auction_id", auctionId)
    .eq("status", "awaiting_payment")
    .order("priority_rank", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getExistingWinner(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .eq("auction_id", auctionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getQueue(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_payment_queue")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, bidder_wallet, amount_lamports, priority_rank, status, payment_due_at, paid_at, skipped_at, created_at, updated_at"
    )
    .eq("auction_id", auctionId)
    .order("priority_rank", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function GET(req: Request) {
  try {
    const wallet = await getViewerWallet();
    if (!wallet) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    if (!(await requireDev(wallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const url = new URL(req.url);
    const targetDate = (url.searchParams.get("target_date") || currentTargetDate()).trim();

    const auction = await getAuction(targetDate);
    if (!auction) {
      return NextResponse.json({ error: "Auction not found for target date" }, { status: 404 });
    }

    const [myRow, currentRow, winner, queue] = await Promise.all([
      getQueueRowForWallet(String(auction.id), wallet),
      getCurrentAwaitingPaymentRow(String(auction.id)),
      getExistingWinner(String(auction.id)),
      getQueue(String(auction.id))
    ]);

    const now = new Date();
    const dueAtMs = currentRow?.payment_due_at ? Date.parse(String(currentRow.payment_due_at)) : NaN;
    const isMyTurn = !!myRow && !!currentRow && String(myRow.id) === String(currentRow.id);

    return NextResponse.json({
      ok: true,
      auction,
      winner,
      queue,
      me: myRow,
      payment: {
        treasuryWallet: getTreasuryWallet(),
        is_my_turn: isMyTurn,
        can_pay:
          isMyTurn &&
          currentRow?.status === "awaiting_payment" &&
          Number.isFinite(dueAtMs) &&
          now.getTime() <= dueAtMs,
        amount_lamports: isMyTurn ? Number(currentRow?.amount_lamports) || 0 : null,
        amount_sol: isMyTurn ? (Number(currentRow?.amount_lamports) || 0) / 1_000_000_000 : null,
        payment_due_at: currentRow?.payment_due_at ?? null,
        ms_remaining: Number.isFinite(dueAtMs) ? Math.max(0, dueAtMs - now.getTime()) : null
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Failed to load bidding ad payment status",
        details: e?.message ?? String(e)
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      error: "Use /api/payments/confirm-bidding-winner to confirm the winner payment after the wallet transaction."
    },
    { status: 405 }
  );
}
