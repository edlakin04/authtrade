// app/api/dev/golden-hour/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RoleRow = { role: string | null };
type ReviewAgg = { count: number; avg: number | null };

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDateOnlyUtc(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Golden Hour timing model for a target day:
// - opt-in opens at previous day 00:00 UTC
// - reveal at target day 11:00 UTC
// - starts at target day 12:00 UTC
// - ends at target day 13:00 UTC
function scheduleForTargetDate(targetDate: string) {
  const day = new Date(`${targetDate}T00:00:00.000Z`);
  const prevDay = addUtcDays(day, -1);

  const optInOpensAt = new Date(Date.UTC(prevDay.getUTCFullYear(), prevDay.getUTCMonth(), prevDay.getUTCDate(), 0, 0, 0, 0));
  const revealAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0, 0, 0));
  const startsAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12, 0, 0, 0));
  const endsAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 13, 0, 0, 0));

  return {
    optInOpensAt,
    revealAt,
    startsAt,
    endsAt
  };
}

function currentTargetDate(now = new Date()) {
  // entry is always for tomorrow's golden hour
  const todayUtc = startOfUtcDay(now);
  return toDateOnlyUtc(addUtcDays(todayUtc, 1));
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

async function getReviewAgg(wallet: string): Promise<ReviewAgg> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("dev_reviews")
    .select("rating")
    .eq("dev_wallet", wallet);

  if (error) return { count: 0, avg: null };

  const rows = data ?? [];
  if (!rows.length) return { count: 0, avg: null };

  const ratings = rows
    .map((r: any) => Number(r.rating))
    .filter((n) => Number.isFinite(n));

  if (!ratings.length) return { count: 0, avg: null };

  const sum = ratings.reduce((a, b) => a + b, 0);
  return {
    count: ratings.length,
    avg: sum / ratings.length
  };
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

async function getEntry(wallet: string, targetDate: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("golden_hour_entries")
    .select("id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, created_at, updated_at")
    .eq("dev_wallet", wallet)
    .eq("target_date", targetDate)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getWinner(targetDate: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("golden_hour_winners")
    .select("id, target_date, entry_id, dev_wallet, coin_id, banner_path, opt_in_opens_at, reveal_at, starts_at, ends_at, created_at")
    .eq("target_date", targetDate)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

function buildStatus(params: {
  wallet: string;
  targetDate: string;
  entry: any | null;
  winner: any | null;
  reviewAgg: ReviewAgg;
  ownedCoins: any[];
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const { optInOpensAt, revealAt, startsAt, endsAt } = scheduleForTargetDate(params.targetDate);

  const isEligible = (params.reviewAgg.avg ?? 0) > 3.5;
  const optInOpen = now >= optInOpensAt && now < startsAt;
  const hasEntered = !!params.entry;
  const revealLive = now >= revealAt;
  const activeNow = now >= startsAt && now < endsAt;
  const winnerChosen = !!params.winner;
  const iWon = !!params.winner && params.winner.dev_wallet === params.wallet;
  const iLost = revealLive && winnerChosen && !iWon && hasEntered;

  let state:
    | "not_eligible"
    | "can_enter"
    | "opted_in"
    | "won"
    | "lost"
    | "closed" = "can_enter";

  if (!isEligible) state = "not_eligible";
  else if (iWon) state = "won";
  else if (iLost) state = "lost";
  else if (hasEntered && optInOpen) state = "opted_in";
  else if (!optInOpen) state = "closed";
  else state = "can_enter";

  return {
    ok: true,
    targetDate: params.targetDate,
    schedule: {
      optInOpensAt: optInOpensAt.toISOString(),
      revealAt: revealAt.toISOString(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString()
    },
    eligibility: {
      isEligible,
      minRating: 3.5,
      avgRating: params.reviewAgg.avg,
      reviewCount: params.reviewAgg.count
    },
    ui: {
      optInOpen,
      revealLive,
      winnerChosen,
      activeNow,
      hasEntered,
      iWon,
      iLost,
      state
    },
    entry: params.entry,
    winner: revealLive ? params.winner : null,
    ownedCoins: params.ownedCoins
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
        entry,
        winner,
        reviewAgg,
        ownedCoins
      })
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load Golden Hour status", details: e?.message ?? String(e) },
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
    const coinId = ((body?.coin_id as string | undefined)?.trim() || "");
    const bannerPath = ((body?.banner_path as string | undefined)?.trim() || "");

    if (!coinId) {
      return NextResponse.json({ error: "coin_id is required" }, { status: 400 });
    }

    if (!bannerPath) {
      return NextResponse.json({ error: "banner_path is required" }, { status: 400 });
    }

    const now = new Date();
    const schedule = scheduleForTargetDate(targetDate);

    if (now < schedule.optInOpensAt) {
      return NextResponse.json({ error: "Golden Hour opt-in is not open yet" }, { status: 400 });
    }

    if (now >= schedule.startsAt) {
      return NextResponse.json({ error: "Golden Hour opt-in is closed for that day" }, { status: 400 });
    }

    const reviewAgg = await getReviewAgg(wallet);
    if ((reviewAgg.avg ?? 0) <= 3.5) {
      return NextResponse.json(
        { error: "You must have a rating above 3.5 to enter Golden Hour" },
        { status: 403 }
      );
    }

    const sb = supabaseAdmin();

    // Verify coin belongs to this dev
    const { data: coin, error: coinErr } = await sb
      .from("coins")
      .select("id, wallet, token_address, title")
      .eq("id", coinId)
      .eq("wallet", wallet)
      .maybeSingle();

    if (coinErr) {
      return NextResponse.json({ error: coinErr.message }, { status: 500 });
    }

    if (!coin) {
      return NextResponse.json({ error: "Selected coin not found" }, { status: 400 });
    }

    // Prevent edits after reveal if winner already exists and reveal is live
    const winner = await getWinner(targetDate);
    if (winner && now >= new Date(winner.reveal_at)) {
      return NextResponse.json(
        { error: "Golden Hour entry can no longer be changed after reveal" },
        { status: 400 }
      );
    }

    const payload = {
      target_date: targetDate,
      dev_wallet: wallet,
      coin_id: coin.id,
      banner_path: bannerPath,
      coin_title: coin.title ?? null,
      token_address: coin.token_address ?? null
    };

    const { data: entry, error: upsertErr } = await sb
      .from("golden_hour_entries")
      .upsert(payload, { onConflict: "target_date,dev_wallet" })
      .select("id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, created_at, updated_at")
      .single();

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    const ownedCoins = await getOwnedCoins(wallet);

    return NextResponse.json(
      buildStatus({
        wallet,
        targetDate,
        entry,
        winner,
        reviewAgg,
        ownedCoins
      })
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to submit Golden Hour entry", details: e?.message ?? String(e) },
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

    const now = new Date();
    const schedule = scheduleForTargetDate(targetDate);

    if (now < schedule.optInOpensAt) {
      return NextResponse.json({ error: "Golden Hour opt-in is not open yet" }, { status: 400 });
    }

    if (now >= schedule.startsAt) {
      return NextResponse.json({ error: "Golden Hour opt-in is closed for that day" }, { status: 400 });
    }

    const winner = await getWinner(targetDate);
    if (winner && now >= new Date(winner.reveal_at)) {
      return NextResponse.json(
        { error: "Golden Hour entry can no longer be removed after reveal" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();
    const { error } = await sb
      .from("golden_hour_entries")
      .delete()
      .eq("dev_wallet", wallet)
      .eq("target_date", targetDate);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const [reviewAgg, ownedCoins, entryAfterDelete, winnerAfterDelete] = await Promise.all([
      getReviewAgg(wallet),
      getOwnedCoins(wallet),
      getEntry(wallet, targetDate),
      getWinner(targetDate)
    ]);

    return NextResponse.json(
      buildStatus({
        wallet,
        targetDate,
        entry: entryAfterDelete,
        winner: winnerAfterDelete,
        reviewAgg,
        ownedCoins
      })
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to remove Golden Hour entry", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
