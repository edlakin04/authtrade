import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const session = await readSessionToken(sessionToken).catch(() => null);
  if (!session?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const sb = supabaseAdmin();

  // Get list of followed dev wallets
  const followsRes = await sb
    .from("follows")
    .select("dev_wallet")
    .eq("follower_wallet", session.wallet);

  if (followsRes.error) return NextResponse.json({ error: followsRes.error.message }, { status: 500 });

  const devWallets = (followsRes.data ?? []).map((x) => x.dev_wallet);
  if (devWallets.length === 0) {
    return NextResponse.json({ ok: true, devWallets: [], posts: [], coins: [] });
  }

  const postsRes = await sb
    .from("dev_posts")
    .select("id, wallet, content, created_at")
    .in("wallet", devWallets)
    .order("created_at", { ascending: false })
    .limit(30);

  if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });

  const coinsRes = await sb
    .from("coins")
    .select("id, wallet, token_address, title, description, created_at")
    .in("wallet", devWallets)
    .order("created_at", { ascending: false })
    .limit(40);

  if (coinsRes.error) return NextResponse.json({ error: coinsRes.error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    devWallets,
    posts: postsRes.data ?? [],
    coins: coinsRes.data ?? []
  });
}
