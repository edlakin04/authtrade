import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

async function getViewerWallet() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  const session = await readSessionToken(sessionToken).catch(() => null);
  return session?.wallet ?? null;
}

async function signFromAnyBucket(sb: ReturnType<typeof supabaseAdmin>, path: string | null) {
  if (!path) return null;

  // Try a few common bucket names so you don’t get blocked by naming differences
  const buckets = ["devposts", "dev-posts", "dev_posts", "posts"];

  for (const b of buckets) {
    const { data, error } = await sb.storage.from(b).createSignedUrl(path, 60 * 30);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  return null;
}

export async function GET() {
  const viewerWallet = await getViewerWallet();
  if (!viewerWallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const sb = supabaseAdmin();

  // Get list of followed dev wallets
  const followsRes = await sb.from("follows").select("dev_wallet").eq("follower_wallet", viewerWallet);
  if (followsRes.error) return NextResponse.json({ error: followsRes.error.message }, { status: 500 });

  const devWallets = (followsRes.data ?? []).map((x) => x.dev_wallet).filter(Boolean);

  if (devWallets.length === 0) {
    return NextResponse.json({ ok: true, devWallets: [], posts: [], coins: [] });
  }

  // IMPORTANT:
  // This assumes your dev_posts table now has image_path (like community_messages does).
  // If your column is named differently, tell me the column name and I’ll swap it.
  const postsRes = await sb
    .from("dev_posts")
    .select("id, wallet, content, image_path, created_at")
    .in("wallet", devWallets)
    .order("created_at", { ascending: false })
    .limit(30);

  if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });

  const rawPosts = postsRes.data ?? [];

  // Sign images (if any)
  const posts = await Promise.all(
    rawPosts.map(async (p: any) => {
      const image_url = await signFromAnyBucket(sb, (p?.image_path ?? null) as string | null);
      return {
        id: p.id,
        wallet: p.wallet,
        content: p.content,
        created_at: p.created_at,
        image_url // ✅ dashboard can render this
      };
    })
  );

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
    posts,
    coins: coinsRes.data ?? []
  });
}
