import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { requireFullAccess } from "@/lib/subscription";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const session = await readSessionToken(sessionToken).catch(() => null);
  if (!session?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const trialBlock = await requireFullAccess();
  if (trialBlock) return trialBlock;

  const body = await req.json().catch(() => null);
  const devWallet = (body?.devWallet as string | undefined)?.trim();
  if (!devWallet) return NextResponse.json({ error: "Missing devWallet" }, { status: 400 });

  const sb = supabaseAdmin();

  const { error } = await sb
    .from("follows")
    .delete()
    .eq("follower_wallet", session.wallet)
    .eq("dev_wallet", devWallet);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
