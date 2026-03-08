// app/api/internal/bidding-ad/settle/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAYMENT_WINDOW_MS = 45 * 1000;

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
  // settle runs at 8:05pm so target date is today (the auction was for today)
  const todayUtc = startOfUtcDay(now);
  return toDateOnlyUtc(todayUtc);
}

function adWindowForTargetDate(targetDate: string) {
  const day = new Date(`${targetDate}T00:00:00.000Z`);
  const nextDay = addUtcDays(day, 1);

  const adStartsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 21, 0, 0, 0)
  );
  const adEndsAt = new Date(
    Date.UTC(nextDay.getUTCFullYear(), nextDay.getUTCMonth(), nextDay.getUTCDate(), 20, 0, 0, 0)
  );

  return { adStartsAt, adEndsAt };
}

function getInternalSecretOk(req: Request) {
  const expected = process.env.INTERNAL_CRON_SECRET || process.env.CRON_SECRET || "";

  // If no secret is configured, allow through (dev environment)
  if (!expected) return true;

  const got = req.headers.get("x-internal-secret") || req.headers.get("authorization") || "";
  if (!got) return false;
  if (got === expected) return true;
  if (got === `Bearer ${expected}`) return true;

  return false;
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

async function getConfirmedWinner(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .eq("auction_id", auctionId)
    .not("payment_confirmed_at", "is", null)
    .order("payment_confirmed_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getExistingPaymentQueue(auctionId: string) {
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

async function getPaidQueueRow(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_payment_queue")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, bidder_wallet, amount_lamports, priority_rank, status, payment_due_at, paid_at, skipped_at, created_at, updated_at"
    )
    .eq("auction_id", auctionId)
    .eq("status", "paid")
    .order("priority_rank", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getOrderedValidBids(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_bids")
    .select(
      `
      id,
      auction_id,
      target_date,
      entry_id,
      bidder_wallet,
      amount_lamports,
      placed_at,
      created_at,
      bidding_ad_entries!inner (
        id,
        auction_id,
        target_date,
        dev_wallet,
        coin_id,
        banner_path,
        coin_title,
        token_address,
        entry_fee_lamports,
        entry_payment_status,
        entry_payment_signature,
        entry_payment_confirmed_at,
        created_at,
        updated_at
      )
    `
    )
    .eq("auction_id", auctionId)
    .order("amount_lamports", { ascending: false })
    .order("placed_at", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];

  // Only include bids from devs who actually paid the entry fee
  return rows.filter((row) => {
    const entry = Array.isArray(row.bidding_ad_entries)
      ? row.bidding_ad_entries[0]
      : row.bidding_ad_entries;
    if (!entry) return false;
    return entry.entry_payment_status === "paid";
  });
}

async function buildQueueIfMissing(auction: any) {
  const existingQueue = await getExistingPaymentQueue(String(auction.id));
  if (existingQueue.length > 0) return existingQueue;

  const bids = await getOrderedValidBids(String(auction.id));

  if (!bids.length) return [];

  const sb = supabaseAdmin();
  const now = new Date();

  const rows = bids.map((bid: any, idx: number) => ({
    auction_id: auction.id,
    target_date: auction.target_date,
    entry_id: bid.entry_id,
    bid_id: bid.id,
    bidder_wallet: bid.bidder_wallet,
    amount_lamports: bid.amount_lamports,
    priority_rank: idx + 1,
    // First bidder in queue gets the 45s payment window immediately
    status: idx === 0 ? "awaiting_payment" : "queued",
    payment_due_at: idx === 0 ? new Date(now.getTime() + PAYMENT_WINDOW_MS).toISOString() : null
  }));

  const { data, error } = await sb
    .from("bidding_ad_payment_queue")
    .insert(rows)
    .select(
      "id, auction_id, target_date, entry_id, bid_id, bidder_wallet, amount_lamports, priority_rank, status, payment_due_at, paid_at, skipped_at, created_at, updated_at"
    )
    .order("priority_rank", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function getEntryById(entryId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_entries")
    .select(
      "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, entry_payment_signature, entry_payment_confirmed_at, created_at, updated_at"
    )
    .eq("id", entryId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function markAuctionStatus(auctionId: string, status: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_auctions")
    .update({ status })
    .eq("id", auctionId)
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function setQueueRowStatus(rowId: string, patch: Record<string, any>) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_payment_queue")
    .update(patch)
    .eq("id", rowId)
    .select(
      "id, auction_id, target_date, entry_id, bid_id, bidder_wallet, amount_lamports, priority_rank, status, payment_due_at, paid_at, skipped_at, created_at, updated_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function createWinnerFromQueueRow(queueRow: any) {
  // Don't create a duplicate winner if one already exists for this auction
  const existingWinner = await getConfirmedWinner(String(queueRow.auction_id));
  if (existingWinner) return existingWinner;

  const entry = await getEntryById(String(queueRow.entry_id));
  if (!entry) throw new Error("Winning entry not found");

  const { adStartsAt, adEndsAt } = adWindowForTargetDate(String(queueRow.target_date));
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .insert({
      auction_id: queueRow.auction_id,
      target_date: queueRow.target_date,
      entry_id: queueRow.entry_id,
      bid_id: queueRow.bid_id,
      dev_wallet: entry.dev_wallet,
      coin_id: entry.coin_id,
      banner_path: entry.banner_path,
      amount_lamports: queueRow.amount_lamports,
      ad_starts_at: adStartsAt.toISOString(),
      ad_ends_at: adEndsAt.toISOString(),
      payment_confirmed_at: queueRow.paid_at ?? new Date().toISOString(),
      payment_signature: null
    })
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data;
}

function summarizeQueue(queue: any[]) {
  const current = queue.find((q) => q.status === "awaiting_payment") ?? null;
  const paid = queue.find((q) => q.status === "paid") ?? null;
  const queued = queue.filter((q) => q.status === "queued");
  const skipped = queue.filter((q) => q.status === "skipped");
  return { current, paid, queued, skipped };
}

async function activateNextQueuedBidder(auctionId: string, now: Date) {
  const queue = await getExistingPaymentQueue(auctionId);
  const nextQueued = queue.find((q) => q.status === "queued") ?? null;

  if (!nextQueued) return null;

  return await setQueueRowStatus(String(nextQueued.id), {
    status: "awaiting_payment",
    payment_due_at: new Date(now.getTime() + PAYMENT_WINDOW_MS).toISOString(),
    skipped_at: null
  });
}

// ─── Core settle logic shared by both GET and POST ───────────────────────────
async function runSettle(req: Request) {
  if (!getInternalSecretOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const targetDate = (url.searchParams.get("target_date") || currentTargetDate()).trim();

  const auction = await getAuction(targetDate);
  if (!auction) {
    return NextResponse.json({ error: "Auction not found for target date" }, { status: 404 });
  }

  const now = new Date();
  const auctionEndsAtMs = Date.parse(String(auction.auction_ends_at));

  if (Number.isFinite(auctionEndsAtMs) && now.getTime() < auctionEndsAtMs) {
    return NextResponse.json({ error: "Auction has not ended yet" }, { status: 400 });
  }

  let updatedAuction = auction;

  // Move status to awaiting_payment if still sitting on scheduled or live
  if (updatedAuction.status === "scheduled" || updatedAuction.status === "live") {
    updatedAuction = await markAuctionStatus(String(updatedAuction.id), "awaiting_payment");
  }

  // If a confirmed winner already exists, nothing left to do
  const existingWinner = await getConfirmedWinner(String(updatedAuction.id));
  if (existingWinner) {
    const queue = await getExistingPaymentQueue(String(updatedAuction.id));
    return NextResponse.json({
      ok: true,
      targetDate,
      auction: updatedAuction,
      winner: existingWinner,
      queue,
      settled: true,
      message: "Winner already finalized"
    });
  }

  // Build the payment queue from ranked bids if it doesn't exist yet
  let queue = await buildQueueIfMissing(updatedAuction);

  if (!queue.length) {
    updatedAuction = await markAuctionStatus(String(updatedAuction.id), "rolled_over");
    return NextResponse.json({
      ok: true,
      targetDate,
      auction: updatedAuction,
      winner: null,
      queue: [],
      settled: true,
      message: "No valid paid bidders. Auction rolled over."
    });
  }

  // If someone already paid via the queue, lock them in as winner
  const alreadyPaid = await getPaidQueueRow(String(updatedAuction.id));
  if (alreadyPaid) {
    const winner = await createWinnerFromQueueRow(alreadyPaid);
    updatedAuction = await markAuctionStatus(String(updatedAuction.id), "completed");
    queue = await getExistingPaymentQueue(String(updatedAuction.id));

    return NextResponse.json({
      ok: true,
      targetDate,
      auction: updatedAuction,
      winner,
      queue,
      settled: true,
      message: "Winner finalized from paid queue row"
    });
  }

  let current = queue.find((q: any) => q.status === "awaiting_payment") ?? null;

  // If nobody is currently awaiting payment, activate the next queued bidder
  if (!current) {
    current = await activateNextQueuedBidder(String(updatedAuction.id), now);
    queue = await getExistingPaymentQueue(String(updatedAuction.id));
  }

  if (!current) {
    updatedAuction = await markAuctionStatus(String(updatedAuction.id), "rolled_over");
    return NextResponse.json({
      ok: true,
      targetDate,
      auction: updatedAuction,
      winner: null,
      queue,
      settled: true,
      message: "No queued bidders remaining. Auction rolled over."
    });
  }

  const dueAtMs = current.payment_due_at ? Date.parse(String(current.payment_due_at)) : NaN;

  // payment_due_at was somehow missing — reset it
  if (!Number.isFinite(dueAtMs)) {
    current = await setQueueRowStatus(String(current.id), {
      status: "awaiting_payment",
      payment_due_at: new Date(now.getTime() + PAYMENT_WINDOW_MS).toISOString()
    });
    queue = await getExistingPaymentQueue(String(updatedAuction.id));

    return NextResponse.json({
      ok: true,
      targetDate,
      auction: updatedAuction,
      winner: null,
      queue,
      currentPaymentRequest: current,
      settled: false,
      message: "Payment window refreshed for current bidder"
    });
  }

  // Window still open — bidder has time left
  if (now.getTime() <= dueAtMs) {
    queue = await getExistingPaymentQueue(String(updatedAuction.id));

    return NextResponse.json({
      ok: true,
      targetDate,
      auction: updatedAuction,
      winner: null,
      queue,
      currentPaymentRequest: current,
      settled: false,
      message: "Awaiting payment from current top bidder"
    });
  }

  // Window expired — skip this bidder and move to the next one
  await setQueueRowStatus(String(current.id), {
    status: "skipped",
    skipped_at: now.toISOString()
  });

  const nextActive = await activateNextQueuedBidder(String(updatedAuction.id), now);
  queue = await getExistingPaymentQueue(String(updatedAuction.id));

  const paidAfter = await getPaidQueueRow(String(updatedAuction.id));
  if (paidAfter) {
    const winner = await createWinnerFromQueueRow(paidAfter);
    updatedAuction = await markAuctionStatus(String(updatedAuction.id), "completed");
    queue = await getExistingPaymentQueue(String(updatedAuction.id));

    return NextResponse.json({
      ok: true,
      targetDate,
      auction: updatedAuction,
      winner,
      queue,
      settled: true,
      message: "Winner finalized"
    });
  }

  if (!nextActive) {
    updatedAuction = await markAuctionStatus(String(updatedAuction.id), "rolled_over");
    return NextResponse.json({
      ok: true,
      targetDate,
      auction: updatedAuction,
      winner: null,
      queue,
      settled: true,
      message: "All payment windows expired. Auction rolled over."
    });
  }

  updatedAuction = await markAuctionStatus(String(updatedAuction.id), "awaiting_payment");

  return NextResponse.json({
    ok: true,
    targetDate,
    auction: updatedAuction,
    winner: null,
    queue,
    currentPaymentRequest: nextActive,
    settled: false,
    message: "Payment window rolled down to next bidder"
  });
}

// ─── GET — called by Vercel cron at 8:05pm UTC ───────────────────────────────
export async function GET(req: Request) {
  try {
    return await runSettle(req);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to settle bidding ad auction", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

// ─── POST — can be called manually if needed ─────────────────────────────────
export async function POST(req: Request) {
  try {
    return await runSettle(req);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to settle bidding ad auction", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
