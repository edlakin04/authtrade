// app/api/dev/bidding-ad/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RoleRow = { role: string | null };

type AuctionRow = {
  id: string;
  target_date: string;
  entry_opens_at: string;
  auction_starts_at: string;
  auction_ends_at: string;
  status: "scheduled" | "live" | "awaiting_payment" | "completed" | "rolled_over" | "cancelled";
  highest_bid_lamports: number | null;
  highest_bidder_wallet: string | null;
  highest_bid_entry_id: string | null;
  last_bid_at: string | null;
  bid_count: number;
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
  entry_payment_signature?: string | null;
  entry_payment_confirmed_at?: string | null;
  created_at: string;
  updated_at: string;
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
  return toDateOnlyUtc(todayUtc);
}

function biddingAdScheduleForTargetDate(targetDate: string) {
  const day = new Date(`${targetDate}T00:00:00.000Z`);
  const prevDay = addUtcDays(day, -1);

  const entryOpensAt = new Date(
    Date.UTC(prevDay.getUTCFullYear(), prevDay.getUTCMonth(), prevDay.getUTCDate(), 23, 0, 0, 0)
  );
  const auctionStartsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 22, 59, 0, 0)
  );
  const auctionEndsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 0, 0)
  );

  return {
    entryOpensAt,
    auctionStartsAt,
    auctionEndsAt
  };
}

function getEntryFeeSol() {
  const sol = Number(process.env.BIDDING_AD_ENTRY_FEE_SOL ?? "1");
  if (!Number.isFinite(sol) || sol <= 0) {
    throw new Error("Invalid BIDDING_AD_ENTRY_FEE_SOL env value");
  }
  return sol;
}

function getEntryFeeLamports() {
  return Math.round(getEntryFeeSol() * 1_000_000_000);
}

function getTreasuryWallet() {
  return (
    process.env.TREASURY_WALLET ||
    process.env.NEXT_PUBLIC_TREASURY_WALLET ||
    ""
  ).trim();
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

async function getOwnedCoins(wallet: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("coins")
    .select("id, wallet, token_address, title, description, created_at")
    .eq("wallet", wallet)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function getEligibility(wallet: string) {
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("dev_profiles")
    .select("avg_rating, review_count")
    .eq("wallet", wallet)
    .maybeSingle();

  const avgRating =
    typeof (data as any)?.avg_rating === "number"
      ? Number((data as any).avg_rating)
      : null;

  const reviewCount =
    typeof (data as any)?.review_count === "number"
      ? Number((data as any).review_count)
      : 0;

  return {
    isEligible: true,
    avgRating,
    reviewCount
  };
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

  if (!insertRes.error && insertRes.data) {
    return insertRes.data as AuctionRow;
  }

  const retryRes = await sb
    .from("bidding_ad_auctions")
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (retryRes.error) throw new Error(retryRes.error.message);
  if (!retryRes.data) {
    throw new Error(insertRes.error?.message || "Failed to create bidding ad auction");
  }

  return retryRes.data as AuctionRow;
}

async function getEntry(wallet: string, targetDate: string): Promise<EntryRow | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_entries")
    .select(
      "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, entry_payment_signature, entry_payment_confirmed_at, created_at, updated_at"
    )
    .eq("dev_wallet", wallet)
    .eq("target_date", targetDate)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as EntryRow | null) ?? null;
}

async function getWinner(targetDate: string): Promise<WinnerRow | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, created_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as WinnerRow | null) ?? null;
}

function deriveAuctionStatus(auction: AuctionRow, winner: WinnerRow | null, now: Date) {
  const startsAt = new Date(auction.auction_starts_at);
  const endsAt = new Date(auction.auction_ends_at);

  if (auction.status === "cancelled") return "cancelled";
  if (auction.status === "completed") return "completed";
  if (auction.status === "rolled_over") return "rolled_over";
  if (auction.status === "awaiting_payment") return "awaiting_payment";

  if (winner?.payment_confirmed_at) return "completed";
  if (now < startsAt) return "scheduled";
  if (now >= startsAt && now < endsAt) return "live";
  if (auction.highest_bid_entry_id) return "awaiting_payment";
  return "rolled_over";
}

async function maybeSyncAuctionStatus(auction: AuctionRow, nextStatus: AuctionRow["status"]) {
  if (auction.status === nextStatus) return auction;

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("bidding_ad_auctions")
    .update({ status: nextStatus })
    .eq("id", auction.id)
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .single();

  if (error || !data) {
    return { ...auction, status: nextStatus };
  }

  return data as AuctionRow;
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

    const { searchParams } = new URL(req.url);
    const targetDate = (searchParams.get("target_date") || currentTargetDate()).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return NextResponse.json({ error: "Invalid target_date" }, { status: 400 });
    }

    const [ownedCoins, eligibility, rawAuction, entry, winner] = await Promise.all([
      getOwnedCoins(wallet),
      getEligibility(wallet),
      getOrCreateAuction(targetDate),
      getEntry(wallet, targetDate),
      getWinner(targetDate)
    ]);

    const now = new Date();
    const derivedStatus = deriveAuctionStatus(rawAuction, winner, now);
    const auction = await maybeSyncAuctionStatus(rawAuction, derivedStatus);

    const entryOpensAt = new Date(auction.entry_opens_at);
    const auctionStartsAt = new Date(auction.auction_starts_at);
    const auctionEndsAt = new Date(auction.auction_ends_at);

    const entryConfirmed = entry?.entry_payment_status === "paid";
    const entryOpen = now >= entryOpensAt && now < auctionStartsAt;
    const auctionLive = now >= auctionStartsAt && now < auctionEndsAt && auction.status === "live";
    const auctionClosed = now >= auctionEndsAt || auction.status !== "scheduled" && auction.status !== "live";

    const iWon = !!winner && winner.dev_wallet === wallet;
    const iLost = !!winner && winner.dev_wallet !== wallet;

    let state: "can_enter" | "entered" | "auction_live" | "won" | "lost" | "closed" = "closed";

    if (iWon) {
      state = "won";
    } else if (iLost) {
      state = "lost";
    } else if (auctionLive && entryConfirmed) {
      state = "auction_live";
    } else if (entryConfirmed) {
      state = "entered";
    } else if (entryOpen) {
      state = "can_enter";
    }

    return NextResponse.json({
      ok: true,
      targetDate,
      schedule: {
        entryOpensAt: auction.entry_opens_at,
        auctionStartsAt: auction.auction_starts_at,
        auctionEndsAt: auction.auction_ends_at
      },
      pricing: {
        entryFeeSol: getEntryFeeSol(),
        entryFeeLamports: getEntryFeeLamports(),
        treasuryWallet: getTreasuryWallet()
      },
      eligibility: {
        isEligible: eligibility.isEligible,
        avgRating: eligibility.avgRating,
        reviewCount: eligibility.reviewCount
      },
      ui: {
        entryOpen,
        auctionLive,
        auctionClosed,
        hasEntered: !!entryConfirmed,
        hasDraftEntry: false,
        iWon,
        state
      },
      auction,
      entry,
      winner,
      ownedCoins,
      payment: {
        treasuryWallet: getTreasuryWallet(),
        entryFeeSol: getEntryFeeSol(),
        entryFeeLamports: getEntryFeeLamports(),
        entryConfirmed: !!entryConfirmed,
        entryPending: false,
        kind: "pay_first_then_create_entry"
      }
    });
  } catch (e: any) {
    console.error("dev bidding-ad GET error:", e);

    return NextResponse.json(
      { error: e?.message ?? "Failed to load Bidding Ad" },
      { status: 500 }
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      error: "Direct entry creation is disabled. Use the bidding entry payment flow first."
    },
    { status: 405 }
  );
}

export async function DELETE(req: Request) {
  try {
    const wallet = await getViewerWallet();
    if (!wallet) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    if (!(await requireDev(wallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const targetDate = (searchParams.get("target_date") || currentTargetDate()).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return NextResponse.json({ error: "Invalid target_date" }, { status: 400 });
    }

    const auction = await getOrCreateAuction(targetDate);
    const now = new Date();
    const auctionStartsAt = new Date(auction.auction_starts_at);

    if (now >= auctionStartsAt) {
      return NextResponse.json(
        { error: "Cannot remove bidding ad entry after the auction has started" },
        { status: 400 }
      );
    }

    const entry = await getEntry(wallet, targetDate);
    if (!entry) {
      return NextResponse.json({ ok: true, removed: false });
    }

    const sb = supabaseAdmin();
    const { error } = await sb
      .from("bidding_ad_entries")
      .delete()
      .eq("id", entry.id)
      .eq("dev_wallet", wallet)
      .eq("target_date", targetDate);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      removed: true,
      targetDate
    });
  } catch (e: any) {
    console.error("dev bidding-ad DELETE error:", e);

    return NextResponse.json(
      { error: e?.message ?? "Failed to remove bidding ad entry" },
      { status: 500 }
    );
  }
}
