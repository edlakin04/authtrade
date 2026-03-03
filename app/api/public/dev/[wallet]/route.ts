import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function signedDevPostImageUrl(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;
  const { data, error } = await sb.storage.from("dev-posts").createSignedUrl(path, 60 * 30);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const devWallet = (wallet ?? "").trim();

  if (!devWallet) return NextResponse.json({ error: "Missing wallet" }, { status: 400 });

  const sb = supabaseAdmin();

  // Optional viewer (signed-in user)
  let viewerWallet: string | null = null;
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (sessionToken) {
      const session = await readSessionToken(sessionToken).catch(() => null);
      if (session?.wallet) viewerWallet = session.wallet;
    }
  } catch {
    // ignore (public route)
  }

  const profileRes = await sb
    .from("dev_profiles")
    .select("wallet, display_name, bio, pfp_url, x_url, created_at, updated_at")
    .eq("wallet", devWallet)
    .maybeSingle();

  if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  if (!profileRes.data) return NextResponse.json({ error: "Dev profile not found" }, { status: 404 });

  const postsRes = await sb
    .from("dev_posts")
    .select("id, wallet, content, image_path, created_at")
    .eq("wallet", devWallet)
    .order("created_at", { ascending: false })
    .limit(50);

  if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });

  const postsRaw = postsRes.data ?? [];

  // Sign image URLs (private bucket)
  const posts = await Promise.all(
    postsRaw.map(async (p: any) => ({
      id: p.id,
      wallet: p.wallet,
      content: p.content,
      created_at: p.created_at,
      image_path: p.image_path ?? null,
      image_url: await signedDevPostImageUrl(sb, p.image_path ?? null)
    }))
  );

  const coinsRes = await sb
    .from("coins")
    .select("id, wallet, token_address, title, description, created_at")
    .eq("wallet", devWallet)
    .order("created_at", { ascending: false })
    .limit(100);

  if (coinsRes.error) return NextResponse.json({ error: coinsRes.error.message }, { status: 500 });

  // Follow status (only if signed in)
  let isFollowing = false;
  if (viewerWallet) {
    const followRes = await sb
      .from("follows")
      .select("follower_wallet, dev_wallet")
      .eq("follower_wallet", viewerWallet)
      .eq("dev_wallet", devWallet)
      .maybeSingle();

    if (!followRes.error && followRes.data) isFollowing = true;
  }

  // ✅ Followers count (public)
  const followersCountRes = await sb
    .from("follows")
    .select("dev_wallet", { count: "exact", head: true })
    .eq("dev_wallet", devWallet);

  if (followersCountRes.error) {
    return NextResponse.json({ error: followersCountRes.error.message }, { status: 500 });
  }

  const followersCount = followersCountRes.count ?? 0;

  return NextResponse.json({
    ok: true,
    viewerWallet,
    isFollowing,
    followersCount,
    profile: profileRes.data,
    posts,
    coins: coinsRes.data ?? []
  });
}
