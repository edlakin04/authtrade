import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");

  if (!secret || secret !== process.env.GOLDEN_HOUR_CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // check if winner already exists
  const { data: existing } = await supabase
    .from("golden_hour_winners")
    .select("*")
    .eq("target_date", today)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: true, message: "Winner already picked" });
  }

  // get entries
  const { data: entries } = await supabase
    .from("golden_hour_entries")
    .select("*")
    .eq("target_date", today);

  if (!entries || entries.length === 0) {
    return NextResponse.json({ ok: true, message: "No entries today" });
  }

  // pick random
  const winner = entries[Math.floor(Math.random() * entries.length)];

  const { error } = await supabase.from("golden_hour_winners").insert({
    target_date: today,
    entry_id: winner.id,
    dev_wallet: winner.dev_wallet,
    coin_id: winner.coin_id,
    banner_path: winner.banner_path
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    winner
  });
}
