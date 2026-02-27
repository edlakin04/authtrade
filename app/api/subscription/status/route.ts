import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = (searchParams.get("wallet") || "").trim();
    if (!wallet) return NextResponse.json({ ok: false, error: "Missing wallet" }, { status: 400 });

    const sb = supabaseAdmin();

    // ✅ EDIT THIS if your table/columns differ
    // Expected columns:
    // - wallet (text)
    // - expires_at (timestamptz)
    // - auto_renew (bool)
    const { data, error } = await sb
      .from("subscriptions")
      .select("wallet, expires_at, auto_renew")
      .eq("wallet", wallet)
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const expiresAt = data?.expires_at ?? null;
    const autoRenew = typeof data?.auto_renew === "boolean" ? data.auto_renew : null;

    const subscribedActive =
      !!expiresAt && new Date(expiresAt).getTime() > Date.now();

    return NextResponse.json({
      ok: true,
      wallet,
      subscribedActive,
      expiresAt,
      autoRenew
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
