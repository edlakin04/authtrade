// app/api/internal/golden-hour/pick/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDateOnlyUtc(d: Date) {
  return d.toISOString().slice(0, 10);
}

function targetDateFromNow(now = new Date()) {
  const todayUtc = startOfUtcDay(now);
  return toDateOnlyUtc(addUtcDays(todayUtc, 1));
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

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function authorized(req: Request) {
  const secret = process.env.GOLDEN_HOUR_PICK_SECRET || process.env.CRON_SECRET || "";
  if (!secret) return true; // allows local/dev if no secret configured

  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const headerSecret = req.headers.get("x-golden-hour-secret") || "";
  return bearer === secret || headerSecret === secret;
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

async function getEntries(targetDate: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("golden_hour_entries")
    .select("id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, created_at, updated_at")
    .eq("target_date", targetDate)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function getReviewAverages(wallets: string[]) {
  const uniq = Array.from(new Set(wallets.filter(Boolean)));
  if (!uniq.length) return new Map<string, { avg: number | null; count: number }>();

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("dev_reviews")
    .select("dev_wallet, rating")
    .in("dev_wallet", uniq);

  if (error) throw new Error(error.message);

  const map = new Map<string, { avg: number | null; count: number }>();

  for (const w of uniq) {
    map.set(w, { avg: null, count: 0 });
  }

  for (const row of data ?? []) {
    const wallet = String((row as any).dev_wallet ?? "");
    const rating = Number((row as any).rating);
    if (!wallet || !Number.isFinite(rating)) continue;

    const prev = map.get(wallet) ?? { avg: null, count: 0 };
    const sum = (prev.avg ?? 0) * prev.count + rating;
    const count = prev.count + 1;
    map.set(wallet, { avg: sum / count, count });
  }

  return map;
}

async function getOwnedCoinSet(coinIds: string[]) {
  const uniq = Array.from(new Set(coinIds.filter(Boolean)));
  if (!uniq.length) return new Set<string>();

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("coins").select("id").in("id", uniq);

  if (error) throw new Error(error.message);

  return new Set((data ?? []).map((x: any) => String(x.id)));
}

export async function POST(req: Request) {
  try {
    if (!authorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const targetDate = ((body?.target_date as string | undefined)?.trim() || targetDateFromNow()).trim();

    const existingWinner = await getWinner(targetDate);
    if (existingWinner) {
      return NextResponse.json({
        ok: true,
        alreadyPicked: true,
        winner: existingWinner
      });
    }

    const entries = await getEntries(targetDate);
    if (!entries.length) {
      return NextResponse.json({
        ok: true,
        alreadyPicked: false,
        picked: false,
        reason: "No entries for target date",
        targetDate
      });
    }

    // Re-validate entries so bad data can't be picked
    const wallets = entries.map((e: any) => String(e.dev_wallet));
    const coinIds = entries.map((e: any) => String(e.coin_id));
    const reviewMap = await getReviewAverages(wallets);
    const ownedCoinSet = await getOwnedCoinSet(coinIds);

    const validEntries = entries.filter((e: any) => {
      const wallet = String(e.dev_wallet ?? "");
      const coinId = String(e.coin_id ?? "");
      const bannerPath = String(e.banner_path ?? "").trim();

      if (!wallet || !coinId || !bannerPath) return false;
      if (!ownedCoinSet.has(coinId)) return false;

      const review = reviewMap.get(wallet) ?? { avg: null, count: 0 };
      return (review.avg ?? 0) > 3.5;
    });

    if (!validEntries.length) {
      return NextResponse.json({
        ok: true,
        alreadyPicked: false,
        picked: false,
        reason: "No valid eligible entries for target date",
        targetDate
      });
    }

    const chosen = shuffleInPlace([...validEntries])[0];
    const schedule = scheduleForTargetDate(targetDate);

    const sb = supabaseAdmin();
    const { data: winner, error: insertErr } = await sb
      .from("golden_hour_winners")
      .insert({
        target_date: targetDate,
        entry_id: chosen.id,
        dev_wallet: chosen.dev_wallet,
        coin_id: chosen.coin_id,
        banner_path: chosen.banner_path,
        opt_in_opens_at: schedule.optInOpensAt.toISOString(),
        reveal_at: schedule.revealAt.toISOString(),
        starts_at: schedule.startsAt.toISOString(),
        ends_at: schedule.endsAt.toISOString()
      })
      .select("id, target_date, entry_id, dev_wallet, coin_id, banner_path, opt_in_opens_at, reveal_at, starts_at, ends_at, created_at")
      .single();

    if (insertErr) {
      // If a concurrent call inserted it first, return the existing winner
      if (String(insertErr.message || "").toLowerCase().includes("duplicate")) {
        const concurrentWinner = await getWinner(targetDate);
        return NextResponse.json({
          ok: true,
          alreadyPicked: true,
          winner: concurrentWinner
        });
      }

      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      alreadyPicked: false,
      picked: true,
      targetDate,
      totalEntries: entries.length,
      validEntries: validEntries.length,
      winner
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to pick Golden Hour winner", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
