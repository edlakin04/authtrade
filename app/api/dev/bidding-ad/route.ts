import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RoleRow = { role: string | null };
type ReviewAgg = { count: number; avg: number | null };

const BIDDING_AD_BANNER_BUCKET = "bidding-ad-banners";
const MAX_BANNER_BYTES = 15 * 1024 * 1024;
const ALLOWED_BANNER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ONE_SOL_LAMPORTS = 1_000_000_000;

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDateOnlyUtc(d: Date) {
  return d.toISOString().slice(0, 10);
}

function safeTrim(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v.trim() : "";
}

function extFromType(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "bin";
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

function getEntryFeeSol() {
  const raw = process.env.BIDDING_AD_ENTRY_FEE_SOL ?? "1";
  const sol = Number(raw);

  if (!Number.isFinite(sol) || sol <= 0) {
    throw new Error("Invalid BIDDING_AD_ENTRY_FEE_SOL env value");
  }

  return sol;
}

function getEntryFeeLamports() {
  return Math.round(getEntryFeeSol() * ONE_SOL_LAMPORTS);
}

/**
 * FINAL SHARED SCHEDULE
 * - targetDate = day the ad will run
 * - entry opens previous UTC day at 23:00
 * - auction starts targetDate at 11:00 UTC
 * - auction ends targetDate at 12:00 UTC
 */
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
  return user?.role === "dev" || user?.role === "admin";
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

async function getReviewAgg(wallet: string): Promise<ReviewAgg> {
  const sb = supabaseAdmin();

  const { data, error } = await sb.from("dev_reviews").select("rating").eq("dev_wallet", wallet);
  if (error) return { count: 0, avg: null };

  const ratings = (data ?? [])
    .map((row: any) => Number(row.rating))
    .filter((n) => Number.isFinite(n));

  if (!ratings.length) return { count: 0, avg: null };

  const sum = ratings.reduce((a, b) => a + b, 0);
  return {
    count: ratings.length,
    avg: sum / ratings.length
  };
}

async function getOrCreateAuction(targetDate: string) {
  const sb = supabaseAdmin();

  const existing = await sb
    .from("bidding_ad_auctions")
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data;

  const schedule = biddingAdScheduleForTargetDate(targetDate);

  const created = await sb
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

  if (!created.error) return created.data;

  const retry = await sb
    .from("bidding_ad_auctions")
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (retry.error) throw new Error(retry.error.message);
  if (!retry.data) throw new Error(created.error.message);

  return retry.data;
}

async function refreshAuctionState(auction: any) {
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

async function getEntry(wallet: string, targetDate: string) {
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
  return data ?? null;
}

async function getWinner(targetDate: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

function buildStatus(params: {
  wallet: string;
  targetDate: string;
  auction: any;
  entry: any | null;
  winner: any | null;
  ownedCoins: any[];
  reviewAgg: ReviewAgg;
  now?: Date;
}) {
  const now = params.now ?? new Date();

  const entryOpensAtMs = Date.parse(String(params.auction.entry_opens_at));
  const auctionStartsAtMs = Date.parse(String(params.auction.auction_starts_at));
  const auctionEndsAtMs = Date.parse(String(params.auction.auction_ends_at));
  const nowMs = now.getTime();

  const entryOpen = nowMs >= entryOpensAtMs && nowMs < auctionStartsAtMs;
  const auctionLive = nowMs >= auctionStartsAtMs && nowMs < auctionEndsAtMs;
  const auctionClosed = nowMs >= auctionEndsAtMs;

  const hasEntered = !!params.entry;
  const iWon = !!params.winner && String(params.winner.dev_wallet) === params.wallet;
  const iLost = !!params.winner && String(params.winner.dev_wallet) !== params.wallet;

  let state: "can_enter" | "entered" | "auction_live" | "won" | "lost" | "closed" = "closed";

  if (iWon) {
    state = "won";
  } else if (iLost) {
    state = "lost";
  } else if (auctionLive && hasEntered) {
    state = "auction_live";
  } else if (entryOpen && hasEntered) {
    state = "entered";
  } else if (entryOpen && !hasEntered) {
    state = "can_enter";
  } else {
    state = "closed";
  }

  return {
    ok: true,
    targetDate: params.targetDate,
    schedule: {
      entryOpensAt: params.auction.entry_opens_at,
      auctionStartsAt: params.auction.auction_starts_at,
      auctionEndsAt: params.auction.auction_ends_at
    },
    pricing: {
      entryFeeSol: getEntryFeeSol(),
      entryFeeLamports: getEntryFeeLamports(),
      treasuryWallet: getTreasuryWallet()
    },
    eligibility: {
      isEligible: true,
      avgRating: params.reviewAgg.avg,
      reviewCount: params.reviewAgg.count
    },
    ui: {
      entryOpen,
      auctionLive,
      auctionClosed,
      hasEntered,
      iWon,
      state
    },
    auction: params.auction,
    entry: params.entry,
    winner: params.winner,
    ownedCoins: params.ownedCoins,
    payment: {
      treasuryWallet: getTreasuryWallet(),
      entryFeeSol: getEntryFeeSol(),
      entryFeeLamports: getEntryFeeLamports(),
      entryConfirmed: params.entry?.entry_payment_status === "paid"
    }
  };
}

async function uploadBiddingAdBanner(wallet: string, targetDate: string, coinId: string, file: File) {
  if (!ALLOWED_BANNER_TYPES.has(file.type)) {
    throw new Error("Invalid banner file type. Allowed: JPG, PNG, WEBP.");
  }

  if (file.size <= 0) {
    throw new Error("Empty banner file.");
  }

  if (file.size > MAX_BANNER_BYTES) {
    throw new Error("Banner file too large (max 15MB).");
  }

  const sb = supabaseAdmin();
  const ext = extFromType(file.type);
  const path = `${wallet}/${targetDate}/${coinId}/banner.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const uploaded = await sb.storage.from(BIDDING_AD_BANNER_BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: true
  });

  if (uploaded.error) throw new Error(uploaded.error.message);
  return path;
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
    auction = await refreshAuctionState(auction);

    const [reviewAgg, ownedCoins, entry, winner] = await Promise.all([
      getReviewAgg(wallet),
      getOwnedCoins(wallet),
      getEntry(wallet, targetDate),
      getWinner(targetDate)
    ]);

    return NextResponse.json(
      buildStatus({
        wallet,
        targetDate,
        auction,
        entry,
        winner,
        ownedCoins,
        reviewAgg
      })
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load bidding ad status", details: e?.message ?? String(e) },
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

    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const targetDate = safeTrim(form.get("target_date")) || currentTargetDate();
    const coinId = safeTrim(form.get("coin_id"));
    const fileEntry = form.get("file");
    const bannerFile = fileEntry instanceof File ? fileEntry : null;

    if (!coinId) {
      return NextResponse.json({ error: "coin_id is required" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    const [reviewAgg, ownedCoins, existingEntry] = await Promise.all([
      getReviewAgg(wallet),
      getOwnedCoins(wallet),
      getEntry(wallet, targetDate)
    ]);

    let auction = await getOrCreateAuction(targetDate);
    auction = await refreshAuctionState(auction);

    const entryOpensAtMs = Date.parse(String(auction.entry_opens_at));
    const auctionStartsAtMs = Date.parse(String(auction.auction_starts_at));
    const nowMs = Date.now();

    if (nowMs < entryOpensAtMs) {
      return NextResponse.json({ error: "Bidding Ad entry is not open yet" }, { status: 400 });
    }

    if (nowMs >= auctionStartsAtMs) {
      return NextResponse.json({ error: "Bidding Ad entry is closed for that day" }, { status: 400 });
    }

    const coinRes = await sb
      .from("coins")
      .select("id, wallet, token_address, title")
      .eq("id", coinId)
      .eq("wallet", wallet)
      .maybeSingle();

    if (coinRes.error) {
      return NextResponse.json({ error: coinRes.error.message }, { status: 500 });
    }

    if (!coinRes.data) {
      return NextResponse.json({ error: "Selected coin not found" }, { status: 400 });
    }

    let bannerPath = existingEntry?.banner_path ?? null;

    if (bannerFile) {
      bannerPath = await uploadBiddingAdBanner(wallet, targetDate, String(coinRes.data.id), bannerFile);
    }

    if (!bannerPath) {
      return NextResponse.json({ error: "A banner is required" }, { status: 400 });
    }

    const payload = {
      auction_id: auction.id,
      target_date: targetDate,
      dev_wallet: wallet,
      coin_id: coinRes.data.id,
      banner_path: bannerPath,
      coin_title: coinRes.data.title ?? null,
      token_address: coinRes.data.token_address ?? null,
      entry_fee_lamports: getEntryFeeLamports(),
      entry_payment_status: existingEntry?.entry_payment_status === "paid" ? "paid" : "pending"
    };

    const upserted = await sb
      .from("bidding_ad_entries")
      .upsert(payload, { onConflict: "target_date,dev_wallet" })
      .select(
        "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, entry_payment_signature, entry_payment_confirmed_at, created_at, updated_at"
      )
      .single();

    if (upserted.error) {
      return NextResponse.json({ error: upserted.error.message }, { status: 500 });
    }

    const winner = await getWinner(targetDate);

    return NextResponse.json({
      ...buildStatus({
        wallet,
        targetDate,
        auction,
        entry: upserted.data,
        winner,
        ownedCoins,
        reviewAgg
      }),
      paymentRequired: upserted.data.entry_payment_status !== "paid",
      payment: {
        treasuryWallet: getTreasuryWallet(),
        entryFeeSol: getEntryFeeSol(),
        entryFeeLamports: getEntryFeeLamports(),
        entryConfirmed: upserted.data.entry_payment_status === "paid",
        kind: "bidding_ad_entry"
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to submit bidding ad entry", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
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

    const url = new URL(req.url);
    const targetDate = (url.searchParams.get("target_date") || currentTargetDate()).trim();

    const [reviewAgg, ownedCoins, existingEntry] = await Promise.all([
      getReviewAgg(wallet),
      getOwnedCoins(wallet),
      getEntry(wallet, targetDate)
    ]);

    let auction = await getOrCreateAuction(targetDate);
    auction = await refreshAuctionState(auction);

    const entryOpensAtMs = Date.parse(String(auction.entry_opens_at));
    const auctionStartsAtMs = Date.parse(String(auction.auction_starts_at));
    const nowMs = Date.now();

    if (nowMs < entryOpensAtMs) {
      return NextResponse.json({ error: "Bidding Ad entry is not open yet" }, { status: 400 });
    }

    if (nowMs >= auctionStartsAtMs) {
      return NextResponse.json({ error: "Bidding Ad entry can no longer be removed" }, { status: 400 });
    }

    if (existingEntry?.entry_payment_status === "paid") {
      return NextResponse.json(
        { error: "Paid bidding entries cannot be removed unless you add a refund flow" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();
    const deleted = await sb
      .from("bidding_ad_entries")
      .delete()
      .eq("dev_wallet", wallet)
      .eq("target_date", targetDate);

    if (deleted.error) {
      return NextResponse.json({ error: deleted.error.message }, { status: 500 });
    }

    const [entryAfterDelete, winner] = await Promise.all([
      getEntry(wallet, targetDate),
      getWinner(targetDate)
    ]);

    return NextResponse.json(
      buildStatus({
        wallet,
        targetDate,
        auction,
        entry: entryAfterDelete,
        winner,
        ownedCoins,
        reviewAgg
      })
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to remove bidding ad entry", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
