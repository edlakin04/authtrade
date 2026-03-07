// app/api/dev/bidding-ad/bids/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ONE_SOL_LAMPORTS = 1_000_000_000;
const MIN_START_BID_LAMPORTS = 10_000_000; // 0.01 SOL
const MIN_BID_INCREMENT_LAMPORTS = 10_000_000; // 0.01 SOL
const EXTENSION_WINDOW_MS = 30 * 1000;
const MAX_EXTENSION_FROM_SCHEDULED_END_MS = 60 * 60 * 1000;
const WINNER_PAYMENT_WINDOW_MS = 45 * 1000;

type RoleRow = { role: string | null };

type AuctionRow = {
  id: string;
  target_date: string;
  entry_opens_at: string;
  auction_starts_at: string;
  auction_ends_at: string;
  status: string;
  highest_bid_lamports: number | null;
  highest_bidder_wallet: string | null;
  highest_bid_entry_id: string | null;
  last_bid_at: string | null;
  bid_count: number | null;
  created_at: string;
  updated_at: string;
};

type EntryRow = {
  id: string;
  auction_id: string;
  target_date: string;
  dev_wallet: string;
  coin_id: string;
  banner_path: string;
  coin_title: string | null;
  token_address: string | null;
  entry_fee_lamports: number;
  entry_payment_status: "pending" | "paid" | "failed" | "refunded";
  entry_payment_signature: string | null;
  entry_payment_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

type BidRow = {
  id: string;
  auction_id: string;
  target_date: string;
  entry_id: string;
  bidder_wallet: string;
  amount_lamports: number;
  placed_at: string;
  created_at: string;
};

type WinnerRow = {
  id: string;
  auction_id: string;
  target_date: string;
  entry_id: string;
  bid_id: string;
  dev_wallet: string;
  coin_id: string;
  banner_path: string;
  amount_lamports: number;
  ad_starts_at: string;
  ad_ends_at: string;
  payment_confirmed_at: string | null;
  payment_signature: string | null;
  created_at: string;
};

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

// MUST match app/api/dev/bidding-ad/route.ts exactly
function biddingAdScheduleForTargetDate(targetDate: string) {
  const day = new Date(`${targetDate}T00:00:00.000Z`);
  const prevDay = addUtcDays(day, -1);

  const entryOpensAt = new Date(
    Date.UTC(prevDay.getUTCFullYear(), prevDay.getUTCMonth(), prevDay.getUTCDate(), 23, 0, 0, 0)
  );
  const auctionStartsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 19, 0, 0, 0)
  );
  const auctionEndsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 20, 0, 0, 0)
  );

  return {
    entryOpensAt,
    auctionStartsAt,
    auctionEndsAt
  };
}

function isExpiredSignatureMarker(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith("EXPIRED:");
}

function makeExpiredSignatureMarker(bidId: string) {
  return `EXPIRED:${bidId}`;
}

function winnerPaymentDueAtIso(winner: WinnerRow | null) {
  if (!winner?.created_at) return null;
  return new Date(new Date(winner.created_at).getTime() + WINNER_PAYMENT_WINDOW_MS).toISOString();
}

function winnerSecondsRemaining(winner: WinnerRow | null, nowMs = Date.now()) {
  if (!winner?.created_at) return 0;
  const dueMs = new Date(winner.created_at).getTime() + WINNER_PAYMENT_WINDOW_MS;
  return Math.max(0, Math.ceil((dueMs - nowMs) / 1000));
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

async function getOrCreateAuction(targetDate: string): Promise<AuctionRow> {
  const sb = supabaseAdmin();

  const existingRes = await sb
    .from("bidding_ad_auctions")
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (existingRes.error) throw new Error(existingRes.error.message);
  if (existingRes.data) return existingRes.data as AuctionRow;

  const schedule = biddingAdScheduleForTargetDate(targetDate);

  const insertRes = await sb
    .from("bidding_ad_auctions")
    .insert({
      target_date: targetDate,
      entry_opens_at: schedule.entryOpensAt.toISOString(),
      auction_starts_at: schedule.auctionStartsAt.toISOString(),
      auction_ends_at: schedule.auctionEndsAt.toISOString(),
      status: "scheduled"
    })
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .single();

  if (insertRes.error) {
    const retryRes = await sb
      .from("bidding_ad_auctions")
      .select(
        "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
      )
      .eq("target_date", targetDate)
      .maybeSingle();

    if (retryRes.error) throw new Error(retryRes.error.message);
    if (!retryRes.data) throw new Error(insertRes.error.message);
    return retryRes.data as AuctionRow;
  }

  return insertRes.data as AuctionRow;
}

async function updateAuctionStatus(auctionId: string, status: string): Promise<AuctionRow> {
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
  return data as AuctionRow;
}

async function syncAuctionStatus(auction: AuctionRow) {
  const now = Date.now();

  const startMs = Date.parse(String(auction.auction_starts_at));
  const endMs = Date.parse(String(auction.auction_ends_at));

  let nextStatus = String(auction.status);

  if ((nextStatus === "scheduled" || nextStatus === "cancelled") && now >= startMs && now < endMs) {
    nextStatus = "live";
  } else if ((nextStatus === "scheduled" || nextStatus === "live") && now >= endMs) {
    nextStatus = "awaiting_payment";
  }

  if (nextStatus === auction.status) return auction;
  return updateAuctionStatus(auction.id, nextStatus);
}

async function getViewerEntry(auctionId: string, targetDate: string, wallet: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_entries")
    .select(
      "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, entry_payment_signature, entry_payment_confirmed_at, created_at, updated_at"
    )
    .eq("auction_id", auctionId)
    .eq("target_date", targetDate)
    .eq("dev_wallet", wallet)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data ?? null) as EntryRow | null;
}

async function getBidHistory(auctionId: string, limit = 50) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_bids")
    .select("id, auction_id, target_date, entry_id, bidder_wallet, amount_lamports, placed_at, created_at")
    .eq("auction_id", auctionId)
    .order("placed_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as BidRow[];
}

async function getRankedBids(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_bids")
    .select("id, auction_id, target_date, entry_id, bidder_wallet, amount_lamports, placed_at, created_at")
    .eq("auction_id", auctionId)
    .order("amount_lamports", { ascending: false })
    .order("placed_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as BidRow[];
}

async function getWinnerAttempts(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .eq("auction_id", auctionId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as WinnerRow[];
}

async function getAuctionWinner(auctionId: string) {
  const attempts = await getWinnerAttempts(auctionId);
  return attempts[0] ?? null;
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
  return (data ?? null) as EntryRow | null;
}

async function insertWinnerAttempt(params: {
  auction: AuctionRow;
  bid: BidRow;
  entry: EntryRow;
}) {
  const sb = supabaseAdmin();

  const adStartsAt = params.auction.auction_ends_at;
  const adEndsAt = new Date(new Date(params.auction.auction_ends_at).getTime() + 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .insert({
      auction_id: params.auction.id,
      target_date: params.auction.target_date,
      entry_id: params.entry.id,
      bid_id: params.bid.id,
      dev_wallet: params.bid.bidder_wallet,
      coin_id: params.entry.coin_id,
      banner_path: params.entry.banner_path,
      amount_lamports: params.bid.amount_lamports,
      ad_starts_at: adStartsAt,
      ad_ends_at: adEndsAt,
      payment_confirmed_at: null,
      payment_signature: null
    })
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data as WinnerRow;
}

async function expireWinnerAttempt(winner: WinnerRow) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .update({
      payment_signature: makeExpiredSignatureMarker(winner.bid_id)
    })
    .eq("id", winner.id)
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data as WinnerRow;
}

async function resolveWinnerState(auction: AuctionRow) {
  let currentAuction = auction;

  if (currentAuction.status === "completed") {
    const completedWinner = await getAuctionWinner(currentAuction.id);
    return {
      auction: currentAuction,
      winner: completedWinner,
      attempts: completedWinner ? [completedWinner] : []
    };
  }

  if (Date.now() < Date.parse(String(currentAuction.auction_ends_at))) {
    const winner = await getAuctionWinner(currentAuction.id);
    return {
      auction: currentAuction,
      winner,
      attempts: winner ? [winner] : []
    };
  }

  if (currentAuction.status === "live" || currentAuction.status === "scheduled") {
    currentAuction = await updateAuctionStatus(currentAuction.id, "awaiting_payment");
  }

  const rankedBids = await getRankedBids(currentAuction.id);
  if (rankedBids.length === 0) {
    return {
      auction: currentAuction,
      winner: null,
      attempts: [] as WinnerRow[]
    };
  }

  while (true) {
    const attempts = await getWinnerAttempts(currentAuction.id);
    const currentWinner = attempts[0] ?? null;

    if (currentWinner?.payment_confirmed_at) {
      if (currentAuction.status !== "completed") {
        currentAuction = await updateAuctionStatus(currentAuction.id, "completed");
      }

      return {
        auction: currentAuction,
        winner: currentWinner,
        attempts
      };
    }

    if (currentWinner && !currentWinner.payment_confirmed_at && !isExpiredSignatureMarker(currentWinner.payment_signature)) {
      const dueMs = new Date(currentWinner.created_at).getTime() + WINNER_PAYMENT_WINDOW_MS;

      if (Date.now() < dueMs) {
        if (currentAuction.status !== "awaiting_payment") {
          currentAuction = await updateAuctionStatus(currentAuction.id, "awaiting_payment");
        }

        return {
          auction: currentAuction,
          winner: currentWinner,
          attempts
        };
      }

      await expireWinnerAttempt(currentWinner);
      continue;
    }

    const exhaustedBidIds = new Set(
      attempts
        .filter((x) => x.payment_confirmed_at || isExpiredSignatureMarker(x.payment_signature))
        .map((x) => x.bid_id)
    );

    const nextBid = rankedBids.find((bid) => !exhaustedBidIds.has(bid.id)) ?? null;

    if (!nextBid) {
      if (currentAuction.status !== "completed") {
        currentAuction = await updateAuctionStatus(currentAuction.id, "completed");
      }

      const finalAttempts = await getWinnerAttempts(currentAuction.id);
      return {
        auction: currentAuction,
        winner: null,
        attempts: finalAttempts
      };
    }

    const entry = await getEntryById(nextBid.entry_id);
    if (!entry || entry.entry_payment_status !== "paid") {
      const fakeExpiredWinner = attempts.find((x) => x.bid_id === nextBid.id);
      if (!fakeExpiredWinner) {
        await insertWinnerAttempt({
          auction: currentAuction,
          bid: nextBid,
          entry: {
            id: nextBid.entry_id,
            auction_id: currentAuction.id,
            target_date: currentAuction.target_date,
            dev_wallet: nextBid.bidder_wallet,
            coin_id: "",
            banner_path: "",
            coin_title: null,
            token_address: null,
            entry_fee_lamports: 0,
            entry_payment_status: "failed",
            entry_payment_signature: null,
            entry_payment_confirmed_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        }).then(expireWinnerAttempt);
      }
      continue;
    }

    const inserted = await insertWinnerAttempt({
      auction: currentAuction,
      bid: nextBid,
      entry
    });

    if (currentAuction.status !== "awaiting_payment") {
      currentAuction = await updateAuctionStatus(currentAuction.id, "awaiting_payment");
    }

    const finalAttempts = await getWinnerAttempts(currentAuction.id);
    return {
      auction: currentAuction,
      winner: inserted,
      attempts: finalAttempts
    };
  }
}

function nextMinimumBidLamports(auction: AuctionRow) {
  const currentHighest = Number(auction.highest_bid_lamports ?? 0);
  if (currentHighest <= 0) return MIN_START_BID_LAMPORTS;
  return currentHighest + MIN_BID_INCREMENT_LAMPORTS;
}

function buildResponse(params: {
  targetDate: string;
  auction: AuctionRow;
  entry: EntryRow | null;
  winner: WinnerRow | null;
  bids: BidRow[];
  viewerWallet: string;
}) {
  const nowMs = Date.now();
  const startMs = Date.parse(String(params.auction.auction_starts_at));
  const endMs = Date.parse(String(params.auction.auction_ends_at));
  const nextMin = nextMinimumBidLamports(params.auction);

  const paymentDueAt = winnerPaymentDueAtIso(params.winner);
  const paymentSecondsRemaining = winnerSecondsRemaining(params.winner, nowMs);
  const viewerIsCurrentWinner = params.winner?.dev_wallet === params.viewerWallet;
  const winnerPaid = !!params.winner?.payment_confirmed_at;
  const winnerExpired = isExpiredSignatureMarker(params.winner?.payment_signature);
  const winnerPaymentOpen =
    !!params.winner &&
    !winnerPaid &&
    !winnerExpired &&
    paymentSecondsRemaining > 0 &&
    params.auction.status === "awaiting_payment";

  return {
    ok: true,
    targetDate: params.targetDate,
    now: new Date(nowMs).toISOString(),
    auction: {
      ...params.auction,
      auction_live: nowMs >= startMs && nowMs < endMs && params.auction.status === "live",
      auction_closed: nowMs >= endMs,
      next_min_bid_lamports: nextMin,
      next_min_bid_sol: nextMin / ONE_SOL_LAMPORTS,
      min_start_bid_lamports: MIN_START_BID_LAMPORTS,
      min_start_bid_sol: MIN_START_BID_LAMPORTS / ONE_SOL_LAMPORTS,
      min_bid_increment_lamports: MIN_BID_INCREMENT_LAMPORTS,
      min_bid_increment_sol: MIN_BID_INCREMENT_LAMPORTS / ONE_SOL_LAMPORTS,
      extension_window_seconds: 30,
      winner_payment_window_seconds: 45
    },
    entry: params.entry,
    winner: params.winner
      ? {
          ...params.winner,
          payment_due_at: paymentDueAt,
          payment_seconds_remaining: paymentSecondsRemaining,
          payment_open: winnerPaymentOpen,
          payment_expired: winnerExpired,
          payment_completed: winnerPaid
        }
      : null,
    viewer: {
      wallet: params.viewerWallet,
      is_current_winner: viewerIsCurrentWinner,
      can_pay_winner_bill: viewerIsCurrentWinner && winnerPaymentOpen,
      winner_payment_due_at: viewerIsCurrentWinner ? paymentDueAt : null,
      winner_payment_seconds_remaining: viewerIsCurrentWinner ? paymentSecondsRemaining : 0
    },
    bids: params.bids
  };
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

    let auction = await getOrCreateAuction(targetDate);
    auction = await syncAuctionStatus(auction);

    const [{ auction: resolvedAuction, winner }, entry, bids] = await Promise.all([
      resolveWinnerState(auction),
      getViewerEntry(String(auction.id), targetDate, wallet),
      getBidHistory(String(auction.id), 50)
    ]);

    return NextResponse.json(
      buildResponse({
        targetDate,
        auction: resolvedAuction,
        entry,
        winner,
        bids,
        viewerWallet: wallet
      })
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load bids", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
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
    const amountSol = Number(body?.amount_sol);

    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return NextResponse.json({ error: "amount_sol is required" }, { status: 400 });
    }

    const amountLamports = Math.round(amountSol * ONE_SOL_LAMPORTS);
    if (!Number.isFinite(amountLamports) || amountLamports <= 0) {
      return NextResponse.json({ error: "Invalid bid amount" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    let auction = await getOrCreateAuction(targetDate);
    auction = await syncAuctionStatus(auction);

    const entry = await getViewerEntry(String(auction.id), targetDate, wallet);
    if (!entry) {
      return NextResponse.json({ error: "You must enter the bidding ad before placing bids" }, { status: 400 });
    }

    if (entry.entry_payment_status !== "paid") {
      return NextResponse.json({ error: "Your entry fee must be paid before you can place bids" }, { status: 400 });
    }

    if (auction.status !== "live") {
      return NextResponse.json({ error: "Auction is not live right now" }, { status: 400 });
    }

    const now = new Date();
    const nowMs = now.getTime();
    const startMs = Date.parse(String(auction.auction_starts_at));
    const endMs = Date.parse(String(auction.auction_ends_at));

    if (!(nowMs >= startMs && nowMs < endMs)) {
      return NextResponse.json({ error: "Auction is not accepting bids right now" }, { status: 400 });
    }

    const minBidLamports = nextMinimumBidLamports(auction);
    if (amountLamports < minBidLamports) {
      return NextResponse.json(
        {
          error: "Bid too low",
          min_bid_lamports: minBidLamports,
          min_bid_sol: minBidLamports / ONE_SOL_LAMPORTS
        },
        { status: 400 }
      );
    }

    const placedAtIso = now.toISOString();

    const insertBid = await sb
      .from("bidding_ad_bids")
      .insert({
        auction_id: auction.id,
        target_date: targetDate,
        entry_id: entry.id,
        bidder_wallet: wallet,
        amount_lamports: amountLamports,
        placed_at: placedAtIso
      })
      .select("id, auction_id, target_date, entry_id, bidder_wallet, amount_lamports, placed_at, created_at")
      .single();

    if (insertBid.error) {
      return NextResponse.json({ error: insertBid.error.message }, { status: 500 });
    }

    let nextAuctionEndsAtIso = String(auction.auction_ends_at);
    const msRemaining = endMs - nowMs;

    if (msRemaining <= EXTENSION_WINDOW_MS) {
      const hardStopMs = Date.parse(String(auction.auction_starts_at)) + MAX_EXTENSION_FROM_SCHEDULED_END_MS;
      const proposedEndMs = nowMs + EXTENSION_WINDOW_MS;
      const finalEndMs = Math.min(proposedEndMs, hardStopMs);
      nextAuctionEndsAtIso = new Date(finalEndMs).toISOString();
    }

    const updateAuction = await sb
      .from("bidding_ad_auctions")
      .update({
        status: "live",
        highest_bid_lamports: amountLamports,
        highest_bidder_wallet: wallet,
        highest_bid_entry_id: entry.id,
        last_bid_at: placedAtIso,
        auction_ends_at: nextAuctionEndsAtIso,
        bid_count: (Number(auction.bid_count) || 0) + 1
      })
      .eq("id", auction.id)
      .select(
        "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
      )
      .single();

    if (updateAuction.error) {
      return NextResponse.json({ error: updateAuction.error.message }, { status: 500 });
    }

    auction = updateAuction.data as AuctionRow;

    const [bids, resolved] = await Promise.all([
      getBidHistory(String(auction.id), 50),
      resolveWinnerState(auction)
    ]);

    return NextResponse.json(
      buildResponse({
        targetDate,
        auction: resolved.auction,
        entry,
        winner: resolved.winner,
        bids,
        viewerWallet: wallet
      })
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to place bid", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
