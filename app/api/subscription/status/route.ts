import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function pickExpiry(row: any): string | null {
  if (!row) return null;

  const candidates = [
    "expires_at",
    "expiresAt",
    "expiry_at",
    "expiryAt",
    "expiry",
    "expires",
    "paid_until",
    "paidUntil",
    "valid_until",
    "validUntil",
    "ends_at",
    "endsAt",
    "end_at",
    "endAt",
    "until"
  ];

  for (const key of candidates) {
    const v = row[key];
    if (typeof v === "string" && v.length > 5) return v;
  }
  return null;
}

function pickAutoRenewKey(row: any): string | null {
  if (!row) return null;
  const candidates = ["auto_renew", "autoRenew", "renew", "is_auto_renew", "isAutoRenew"];
  for (const key of candidates) {
    if (typeof row[key] === "boolean") return key;
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = (searchParams.get("wallet") || "").trim();
    if (!wallet) return NextResponse.json({ ok: false, error: "Missing wallet" }, { status: 400 });

    const sb = supabaseAdmin();

    // ✅ do not hardcode column names
    const { data, error } = await sb.from("subscriptions").select("*").eq("wallet", wallet).maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const expiresAt = pickExpiry(data);
    const hasEverSubscribed = !!data; // row exists means they’ve subscribed before (or at least a record exists)
    const autoRenewKey = pickAutoRenewKey(data);
    const autoRenew = autoRenewKey ? (data as any)[autoRenewKey] : null;

    const subscribedActive =
      !!expiresAt && new Date(expiresAt).getTime() > Date.now();

    return NextResponse.json({
      ok: true,
      wallet,
      subscribedActive,
      expiresAt: expiresAt ?? null,
      autoRenew,
      hasEverSubscribed
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
