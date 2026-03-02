import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function getViewerWallet() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

export async function GET() {
  try {
    const wallet = await getViewerWallet();
    if (!wallet) return NextResponse.json({ ok: true, wallet: null, isDev: false });

    const sb = supabaseAdmin();

    // If a dev has a dev profile row, treat them as dev
    const { data: devRow, error } = await sb
      .from("dev_profiles")
      .select("wallet")
      .eq("wallet", wallet)
      .maybeSingle();

    if (error) {
      // fail closed: don't break account page
      return NextResponse.json({ ok: true, wallet, isDev: false });
    }

    return NextResponse.json({ ok: true, wallet, isDev: !!devRow });
  } catch {
    return NextResponse.json({ ok: true, wallet: null, isDev: false });
  }
}
