import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createSubToken, subCookie } from "@/lib/subscription";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ ok: false }, { status: 401 });

  const sessionData = await readSessionToken(sessionToken).catch(() => null);
  if (!sessionData?.wallet) return NextResponse.json({ ok: false }, { status: 401 });

  const sb = supabaseAdmin();
  const { data: subRow, error } = await sb
    .from("subscriptions")
    .select("paid_until")
    .eq("wallet", sessionData.wallet)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!subRow?.paid_until) return NextResponse.json({ ok: true, active: false });

  const paidUntil = new Date(subRow.paid_until).getTime();
  const active = paidUntil > Date.now();

  if (active) {
    const token = await createSubToken({ wallet: sessionData.wallet, paidUntilMs: paidUntil });
    const res = NextResponse.json({ ok: true, active: true, paidUntilMs: paidUntil });
    res.headers.set("Set-Cookie", subCookie(token));
    return res;
  }

  return NextResponse.json({ ok: true, active: false, paidUntilMs: paidUntil });
}
