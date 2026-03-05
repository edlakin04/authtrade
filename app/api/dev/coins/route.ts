import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function looksLikeSolAddress(s: string) {
  return s.length >= 32 && s.length <= 50;
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const session = await readSessionToken(sessionToken).catch(() => null);
  if (!session?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const sb = supabaseAdmin();

  const { data: user } = await sb.from("users").select("role").eq("wallet", session.wallet).maybeSingle();

  if (user?.role !== "dev" && user?.role !== "admin") {
    return NextResponse.json({ error: "Not a dev" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  const token_address = (body?.token_address as string | undefined)?.trim();
  const title = (body?.title as string | undefined)?.trim() ?? null;
  const description = (body?.description as string | undefined)?.trim() ?? null;

  if (!token_address || !looksLikeSolAddress(token_address)) {
    return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  }

  // ✅ insert coin and return created row
  const { data, error } = await sb
    .from("coins")
    .insert({
      wallet: session.wallet,
      token_address,
      title,
      description
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    coin: data
  });
}

/**
 * Coins are permanent and cannot be removed individually.
 * They are only removed when the dev deletes their whole profile.
 */
export async function DELETE() {
  return NextResponse.json(
    { error: "Coin removal is disabled. Delete your profile to remove your coins." },
    { status: 405 }
  );
}
