import { NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction
} from "@solana/web3.js";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WINNER_PAYMENT_WINDOW_MS = 45 * 1000;

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
  return toDateOnlyUtc(todayUtc);
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

  const { data: user } = await sb
    .from("users")
    .select("role")
    .eq("wallet", wallet)
    .maybeSingle<RoleRow>();

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
  if (!data) throw new Error("Auction not found for target date");
  return data;
}

// Use the payment queue as the source of truth — same as confirm-bidding-winner
async function getCurrentQueueRow(auctionId: string) {
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

export async function POST(req: Request) {
  try {
    const wallet = await getViewerWallet();
    if (!wallet) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    if (!(await requireDev(wallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const targetDate = ((body?.target_date as string | undefined)?.trim() || currentTargetDate());

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return NextResponse.json({ error: "Invalid target_date" }, { status: 400 });
    }

    const auction = await getAuction(targetDate);

    // Allow both awaiting_payment and completed — the queue row is the real source
    // of truth, not the auction status, which can move to completed slightly early
    if (auction.status !== "awaiting_payment" && auction.status !== "completed") {
      return NextResponse.json({ error: "Winner payment is not active right now" }, { status: 400 });
    }

    // Look up the current queue row — this is the single source of truth for
    // who is currently allowed to pay, matching confirm-bidding-winner exactly
    const queueRow = await getCurrentQueueRow(String(auction.id));
    if (!queueRow) {
      return NextResponse.json({ error: "No active payment window found" }, { status: 404 });
    }

    if (String(queueRow.bidder_wallet) !== wallet) {
      return NextResponse.json({ error: "It is not your turn to pay" }, { status: 403 });
    }

    const dueAtMs = queueRow.payment_due_at ? Date.parse(String(queueRow.payment_due_at)) : NaN;

    if (!Number.isFinite(dueAtMs)) {
      return NextResponse.json({ error: "Payment due time is missing" }, { status: 400 });
    }

    const nowMs = Date.now();
    if (nowMs >= dueAtMs) {
      return NextResponse.json({ error: "Your payment window has expired" }, { status: 400 });
    }

    const lamports = Number(queueRow.amount_lamports ?? 0);
    if (!Number.isFinite(lamports) || lamports <= 0) {
      return NextResponse.json({ error: "Invalid winner payment amount" }, { status: 400 });
    }

    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: "Server missing SOLANA_RPC_URL" }, { status: 500 });
    }

    const treasuryWallet = getTreasuryWallet();

    const connection = new Connection(rpcUrl, "confirmed");
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

    const fromPubkey = new PublicKey(wallet);
    const toPubkey = new PublicKey(treasuryWallet);

    const tx = new Transaction({
      feePayer: fromPubkey,
      recentBlockhash: blockhash
    }).add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports
      })
    );

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    });

    return NextResponse.json({
      ok: true,
      targetDate,
      winner: {
        id: String(queueRow.id),
        bid_id: String(queueRow.bid_id),
        amount_lamports: lamports,
        amount_sol: lamports / 1_000_000_000,
        payment_due_at: new Date(dueAtMs).toISOString(),
        payment_seconds_remaining: Math.max(0, Math.ceil((dueAtMs - nowMs) / 1000))
      },
      payment: {
        treasuryWallet,
        amount_lamports: lamports,
        amount_sol: lamports / 1_000_000_000
      },
      tx: {
        serialized_base64: serialized.toString("base64"),
        blockhash,
        lastValidBlockHeight
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Failed to create winner payment transaction",
        details: e?.message ?? String(e)
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST to create the winner payment transaction." },
    { status: 405 }
  );
}
