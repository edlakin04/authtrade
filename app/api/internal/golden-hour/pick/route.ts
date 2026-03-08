import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function utcDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

// Golden Hour runs 8pm–9pm UTC on the target date
function goldenHourWindowForDate(targetDate: string) {
  const day = new Date(`${targetDate}T00:00:00.000Z`);

  const startsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 20, 0, 0, 0)
  );
  const endsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 21, 0, 0, 0)
  );
  const revealAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 19, 55, 0, 0)
  );
  const optInOpensAt = addUtcDays(
    new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0)),
    -1
  );

  return { startsAt, endsAt, revealAt, optInOpensAt };
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.GOLDEN_HOUR_CRON_SECRET;

  // No secret configured — allow through (useful for local dev)
  if (!expected) return true;

  // Vercel crons send the secret as a Bearer token in the Authorization header
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader === `Bearer ${expected}`) return true;

  // Also accept direct secret match for manual calls
  if (authHeader === expected) return true;

  // Legacy x-cron-secret header support
  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  if (cronSecret === expected) return true;

  return false;
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    const now = new Date();
    const targetDate = utcDateOnly(now);

    // Already picked a winner today — nothing to do
    const existingRes = await sb
      .from("golden_hour_winners")
      .select("id, target_date")
      .eq("target_date", targetDate)
      .maybeSingle();

    if (existingRes.error) {
      return NextResponse.json({ error: existingRes.error.message }, { status: 500 });
    }

    if (existingRes.data) {
      return NextResponse.json({
        ok: true,
        message: "Winner already picked",
        targetDate
      });
    }

    // Load all eligible entries for today
    const entriesRes = await sb
      .from("golden_hour_entries")
      .select("id, target_date, dev_wallet, coin_id, banner_path")
      .eq("target_date", targetDate);

    if (entriesRes.error) {
      return NextResponse.json({ error: entriesRes.error.message }, { status: 500 });
    }

    const entries = entriesRes.data ?? [];

    if (entries.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No entries today",
        targetDate
      });
    }

    // Pick a random winner
    const winner = entries[Math.floor(Math.random() * entries.length)];

    // Calculate the ad window for today so the dashboard can filter correctly
    const { startsAt, endsAt, revealAt, optInOpensAt } = goldenHourWindowForDate(targetDate);

    const insertRes = await sb.from("golden_hour_winners").insert({
      target_date: targetDate,
      entry_id: winner.id,
      dev_wallet: winner.dev_wallet,
      coin_id: winner.coin_id,
      banner_path: winner.banner_path,
      // These are what the dashboard filters on — without them the ad never shows
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      reveal_at: revealAt.toISOString(),
      opt_in_opens_at: optInOpensAt.toISOString()
    });

    if (insertRes.error) {
      return NextResponse.json({ error: insertRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      targetDate,
      winner,
      schedule: {
        optInOpensAt: optInOpensAt.toISOString(),
        revealAt: revealAt.toISOString(),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString()
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to pick Golden Hour winner", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
