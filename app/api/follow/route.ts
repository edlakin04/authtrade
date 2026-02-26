import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const session = await readSessionToken(sessionToken).catch(() => null);
  if (!session?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const devWallet = (body?.devWallet as string | undefined)?.trim();
  if (!devWallet) return NextResponse.json({ error: "Missing devWallet" }, { status: 400 });

  if (devWallet === session.wallet) {
    return NextResponse.json({ error: "You can't follow yourself" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Ensure user exists
  await sb.from("users").upsert({ wallet: session.wallet });

  // Ensure target is actually a dev profile (prevents following random wallets)
  const { data: profile } = await sb
    .from("dev_profiles")
    .select("wallet")
    .eq("wallet", devWallet)
    .maybeSingle();

  if (!profile) return NextResponse.json({ error: "Dev not found" }, { status: 404 });

  const { error } = await sb.from("follows").upsert({
    follower_wallet: session.wallet,
    dev_wallet: devWallet
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
