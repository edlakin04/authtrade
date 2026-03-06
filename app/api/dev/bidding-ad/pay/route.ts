// app/api/dev/bidding-ad/pay/route.ts
import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
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

function adWindowForTargetDate(targetDate: string) {
  const day = new Date(`${targetDate}T00:00:00.000Z`);

  // Paid ad runs after Golden Hour ends: 13:00 UTC -> +23h
  const adStartsAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 13, 0, 0, 0));
  const adEndsAt = new Date(adStartsAt.getTime() + 23 * 60 * 60 * 1000);

  return {
    adStartsAt,
    adEndsAt
  };
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
    .in("status", ["awaiting_payment", "queued", "paid"])
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

async function getEntry(entryId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_entries")
    .select(
      "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, created_at, updated_at"
    )
    .eq("id", entryId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function markQueueRowPaid(rowId: string, paidAtIso: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_payment_queue")
    .update({
      status: "paid",
      paid_at: paidAtIso
    })
    .eq("id", rowId)
    .select(
      "id, auction_id, target_date, entry_id, bid_id, bidder_wallet, amount_lamports, priority_rank, status, payment_due_at, paid_at, skipped_at, created_at, updated_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function markAuctionCompleted(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_auctions")
    .update({ status: "completed" })
    .eq("id", auctionId)
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function createWinner(params: {
  auctionId: string;
  targetDate: string;
  entryId: string;
  bidId: string;
  amountLamports: number;
  paidAtIso: string;
  signature: string;
}) {
  const existing = await getExistingWinner(params.auctionId);
  if (existing) return existing;

  const entry = await getEntry(params.entryId);
  if (!entry) throw new Error("Winning entry not found");

  const { adStartsAt, adEndsAt } = adWindowForTargetDate(params.targetDate);
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .insert({
      auction_id: params.auctionId,
      target_date: params.targetDate,
      entry_id: params.entryId,
      bid_id: params.bidId,
      dev_wallet: entry.dev_wallet,
      coin_id: entry.coin_id,
      banner_path: entry.banner_path,
      amount_lamports: params.amountLamports,
      ad_starts_at: adStartsAt.toISOString(),
      ad_ends_at: adEndsAt.toISOString(),
      payment_confirmed_at: params.paidAtIso,
      payment_signature: params.signature
    })
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data;
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

async function getWinnerBySignature(signature: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .eq("payment_signature", signature)
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
    const signature = (body?.signature as string | undefined)?.trim();

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    const auction = await getAuction(targetDate);
    if (!auction) {
      return NextResponse.json({ error: "Auction not found for target date" }, { status: 404 });
    }

    if (auction.status !== "awaiting_payment") {
      return NextResponse.json(
        { error: "Auction is not currently awaiting payment" },
        { status: 400 }
      );
    }

    const existingWinner = await getExistingWinner(String(auction.id));
    if (existingWinner?.payment_confirmed_at) {
      return NextResponse.json({
        ok: true,
        auction,
        winner: existingWinner,
        queue: await getQueue(String(auction.id)),
        message: "Auction winner already paid"
      });
    }

    const winnerBySig = await getWinnerBySignature(signature);
    if (winnerBySig) {
      return NextResponse.json({
        ok: true,
        auction,
        winner: winnerBySig,
        queue: await getQueue(String(auction.id)),
        message: "Signature already used for this payment"
      });
    }

    const currentRow = await getCurrentAwaitingPaymentRow(String(auction.id));
    if (!currentRow) {
      return NextResponse.json(
        { error: "There is no active payment window right now" },
        { status: 400 }
      );
    }

    const myRow = await getQueueRowForWallet(String(auction.id), wallet);
    if (!myRow) {
      return NextResponse.json(
        { error: "You are not in this auction payment queue" },
        { status: 403 }
      );
    }

    if (String(currentRow.id) !== String(myRow.id)) {
      return NextResponse.json(
        { error: "It is not your turn to pay" },
        { status: 403 }
      );
    }

    if (currentRow.status !== "awaiting_payment") {
      return NextResponse.json(
        { error: "Your payment window is not active" },
        { status: 400 }
      );
    }

    const now = new Date();
    const dueAtMs = currentRow.payment_due_at ? Date.parse(String(currentRow.payment_due_at)) : NaN;

    if (!Number.isFinite(dueAtMs)) {
      return NextResponse.json(
        { error: "Payment due time is missing" },
        { status: 400 }
      );
    }

    if (now.getTime() > dueAtMs) {
      return NextResponse.json(
        { error: "Your payment window has expired" },
        { status: 400 }
      );
    }

    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: "Server missing SOLANA_RPC_URL" }, { status: 500 });
    }

    const treasuryWallet = getTreasuryWallet();
    const connection = new Connection(rpcUrl, "confirmed");

    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });

    if (!tx || !tx.meta) {
      return NextResponse.json(
        { error: "Transaction not confirmed yet. Try again." },
        { status: 400 }
      );
    }

    const staticKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const payer = staticKeys[0]?.toBase58();

    if (!payer || payer !== wallet) {
      return NextResponse.json(
        { error: "Payer wallet mismatch" },
        { status: 400 }
      );
    }

    const treasuryKey = new PublicKey(treasuryWallet);
    const treasuryIndex = staticKeys.findIndex((k) => k.equals(treasuryKey));

    if (treasuryIndex === -1) {
      return NextResponse.json(
        { error: "Treasury wallet not involved in transaction" },
        { status: 400 }
      );
    }

    const preLamports = tx.meta.preBalances[treasuryIndex] ?? 0;
    const postLamports = tx.meta.postBalances[treasuryIndex] ?? 0;
    const deltaLamports = postLamports - preLamports;

    const requiredLamports = Number(currentRow.amount_lamports) || 0;

    if (!Number.isFinite(requiredLamports) || requiredLamports <= 0) {
      return NextResponse.json(
        { error: "Winning bid amount is invalid" },
        { status: 400 }
      );
    }

    if (deltaLamports < requiredLamports) {
      return NextResponse.json(
        {
          error: `Winning payment too low. Received ${deltaLamports} lamports, expected at least ${requiredLamports}.`
        },
        { status: 400 }
      );
    }

    const paidAtIso = now.toISOString();

    const paidRow = await markQueueRowPaid(String(currentRow.id), paidAtIso);
    const winner = await createWinner({
      auctionId: String(auction.id),
      targetDate,
      entryId: String(paidRow.entry_id),
      bidId: String(paidRow.bid_id),
      amountLamports: Number(paidRow.amount_lamports) || 0,
      paidAtIso,
      signature
    });

    const updatedAuction = await markAuctionCompleted(String(auction.id));
    const queue = await getQueue(String(auction.id));

    return NextResponse.json({
      ok: true,
      auction: updatedAuction,
      winner,
      queue,
      payment: {
        paid: true,
        paid_at: paidAtIso,
        signature
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Failed to pay bidding ad winner amount",
        details: e?.message ?? String(e)
      },
      { status: 500 }
    );
  }
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

    return NextResponse.json({
      ok: true,
      auction,
      winner,
      queue,
      me: myRow,
      payment: {
        treasuryWallet: getTreasuryWallet(),
        is_my_turn: !!myRow && !!currentRow && String(myRow.id) === String(currentRow.id),
        can_pay:
          !!myRow &&
          !!currentRow &&
          String(myRow.id) === String(currentRow.id) &&
          currentRow.status === "awaiting_payment" &&
          Number.isFinite(dueAtMs) &&
          now.getTime() <= dueAtMs,
        amount_lamports:
          !!myRow && !!currentRow && String(myRow.id) === String(currentRow.id)
            ? Number(currentRow.amount_lamports) || 0
            : null,
        amount_sol:
          !!myRow && !!currentRow && String(myRow.id) === String(currentRow.id)
            ? (Number(currentRow.amount_lamports) || 0) / 1_000_000_000
            : null,
        payment_due_at: currentRow?.payment_due_at ?? null,
        ms_remaining:
          Number.isFinite(dueAtMs) ? Math.max(0, dueAtMs - now.getTime()) : null
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
