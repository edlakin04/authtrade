import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const wallet = String(body?.wallet || "").trim();
    if (!wallet) return NextResponse.json({ error: "Missing wallet" }, { status: 400 });

    const sb = supabaseAdmin();

    // ✅ EDIT THIS if your table/columns differ
    const { error } = await sb
      .from("subscriptions")
      .update({
        auto_renew: false,
        canceled_at: new Date().toISOString()
      })
      .eq("wallet", wallet);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
