import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function pickAutoRenewKey(row: any): string | null {
  if (!row) return null;
  const candidates = ["auto_renew", "autoRenew", "renew", "is_auto_renew", "isAutoRenew"];
  for (const key of candidates) {
    if (key in row) return key;
  }
  return null;
}

function hasColumn(row: any, col: string) {
  return row && Object.prototype.hasOwnProperty.call(row, col);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const wallet = String(body?.wallet || "").trim();
    if (!wallet) return NextResponse.json({ error: "Missing wallet" }, { status: 400 });

    const sb = supabaseAdmin();

    // Fetch row first so we only update existing columns
    const { data, error: readErr } = await sb.from("subscriptions").select("*").eq("wallet", wallet).maybeSingle();
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

    if (!data) {
      // Nothing to cancel
      return NextResponse.json({ ok: true, note: "No subscription record found for wallet." });
    }

    const update: Record<string, any> = {};
    const autoKey = pickAutoRenewKey(data);
    if (autoKey) update[autoKey] = false;

    if (hasColumn(data, "canceled_at")) update["canceled_at"] = new Date().toISOString();
    if (hasColumn(data, "canceledAt")) update["canceledAt"] = new Date().toISOString();

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No auto-renew/cancel columns found on subscriptions row. Add auto_renew boolean to enable cancel." },
        { status: 400 }
      );
    }

    const { error: updErr } = await sb.from("subscriptions").update(update).eq("wallet", wallet);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
