import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ONE_SOL_LAMPORTS = 1_000_000_000;
const MIN_BID_INCREMENT_LAMPORTS = ONE_SOL_LAMPORTS;
const EXTENSION_WINDOW_MS = 30 * 1000;
const MAX_EXTENSION_FROM_SCHEDULED_END_MS = 60 * 60 * 1000;

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

// MUST match app/api/dev/bidding-ad/route.ts exactly
function biddingAdScheduleForTargetDate(targetDate: string) {
  const day = new Date(`${targetDate}T00:00:00.000Z`);
  const prevDay = addUtcDays(day, -1);

  const entryOpensAt = new Date(
    Date.UTC(prevDay.getUTCFullYear(), prevDay.getUTCMonth(), prevDay.getUTCDate(), 23, 0, 0, 0)
  );
  const auctionStartsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0, 0, 0)
  );
  const auctionEndsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12, 0, 0, 0)
  );

  return {
    entryOpensAt,
    auctionStartsAt,
    auctionEndsAt
  };
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

async function getOrCreateAuction(targetDate: string) {
  const sb = supabaseAdmin();

  const existingRes = await sb
    .from("bidding_ad_auctions")
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (existingRes.error) throw new Error(existingRes.error.message);
  if (existingRes.data) return existingRes.data;

  const schedule = scheduleForTargetDate(targetDate);

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
    return retryRes.data;
  }

  return insertRes.data;
}

async function syncAuctionStatus(auction: any) {
  const sb = supabaseAdmin();
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

  const { data, error } = await sb
    .from("bidding_ad_auctions")
    .update({ status: nextStatus })
    .eq("id", auction.id)
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data;
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
  return data ?? null;
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
  return data ?? [];
}

async function getAuctionWinner(auctionId: string) {
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

function nextMinimumBidLamports(auction: any) {
  if (auction.highest_bid_lamports == null) return ONE_SOL_LAMPORTS;
  return (Number(auction.highest_bid_lamports) || 0) + MIN_BID_INCREMENT_LAMPORTS;
}

function buildResponse(params: {
  targetDate: string;
  auction: any;
  entry: any | null;
  winner: any | null;
  bids: any[];
}) {
  const nowMs = Date.now();
  const startMs = Date.parse(String(params.auction.auction_starts_at));
  const endMs = Date.parse(String(params.auction.auction_ends_at));
  const nextMin = nextMinimumBidLamports(params.auction);

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
      extension_window_seconds: 30
    },
    entry: params.entry,
    winner: params.winner,
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

    const [entry, bids, winner] = await Promise.all([
      getViewerEntry(String(auction.id), targetDate, wallet),
      getBidHistory(String(auction.id), 50),
      getAuctionWinner(String(auction.id))
    ]);

    return NextResponse.json(
      buildResponse({
        targetDate,
        auction,
        entry,
        winner,
        bids
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

    auction = updateAuction.data;

    const [bids, winner] = await Promise.all([
      getBidHistory(String(auction.id), 50),
      getAuctionWinner(String(auction.id))
    ]);

    return NextResponse.json(
      buildResponse({
        targetDate,
        auction,
        entry,
        winner,
        bids
      })
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to place bid", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
