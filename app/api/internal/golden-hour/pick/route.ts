import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function utcDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const secret = req.headers.get("x-cron-secret");
    const expected = process.env.GOLDEN_HOUR_CRON_SECRET;

    if (!expected || secret !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    const now = new Date();
    const targetDate = utcDateOnly(now);

    // already picked?
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

    // load eligible entries for target date
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

    const winner = entries[Math.floor(Math.random() * entries.length)];

    const insertRes = await sb.from("golden_hour_winners").insert({
      target_date: targetDate,
      entry_id: winner.id,
      dev_wallet: winner.dev_wallet,
      coin_id: winner.coin_id,
      banner_path: winner.banner_path
    });

    if (insertRes.error) {
      return NextResponse.json({ error: insertRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      targetDate,
      winner
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to pick Golden Hour winner", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
