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

  const buckets = ["devposts", "dev-posts", "dev_posts", "posts"];

  for (const b of buckets) {
    const { data, error } = await sb.storage.from(b).createSignedUrl(path, 60 * 30);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  return null;
}

export async function GET() {
  const viewerWallet = await getViewerWallet();
  if (!viewerWallet) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  /* ---------- FOLLOWED DEVS ---------- */

  const followsRes = await sb
    .from("follows")
    .select("dev_wallet")
    .eq("follower_wallet", viewerWallet);

  if (followsRes.error) {
    return NextResponse.json({ error: followsRes.error.message }, { status: 500 });
  }

  const devWallets = (followsRes.data ?? []).map((x) => x.dev_wallet).filter(Boolean);

  if (devWallets.length === 0) {
    return NextResponse.json({
      ok: true,
      devWallets: [],
      posts: [],
      coins: []
    });
  }

  /* ---------- DEV POSTS ---------- */

  const postsRes = await sb
    .from("dev_posts")
    .select("id, wallet, content, image_path, poll_id, created_at")
    .in("wallet", devWallets)
    .order("created_at", { ascending: false })
    .limit(30);

  if (postsRes.error) {
    return NextResponse.json({ error: postsRes.error.message }, { status: 500 });
  }

  const rawPosts = postsRes.data ?? [];

  /* ---------- POLL DATA ---------- */

  const pollIds = rawPosts.map((p: any) => p.poll_id).filter(Boolean);
  const pollMap = new Map();

  if (pollIds.length) {
    const { data: polls } = await sb
      .from("dev_post_polls")
      .select("id, question")
      .in("id", pollIds);

    const { data: options } = await sb
      .from("dev_post_poll_options")
      .select("id, poll_id, label, sort_order")
      .in("poll_id", pollIds);

    const { data: votes } = await sb
      .from("dev_post_poll_votes")
      .select("poll_id, option_id, voter_wallet")
      .in("poll_id", pollIds);

    for (const p of polls ?? []) {
      pollMap.set(p.id, {
        id: p.id,
        question: p.question,
        options: []
      });
    }

    for (const o of options ?? []) {
      const p = pollMap.get(o.poll_id);
      if (!p) continue;

      p.options.push({
        id: o.id,
        label: o.label,
        votes: 0
      });
    }

    for (const v of votes ?? []) {
      const p = pollMap.get(v.poll_id);
      if (!p) continue;

      const opt = p.options.find((x: any) => x.id === v.option_id);
      if (opt) opt.votes++;

      if (v.voter_wallet === viewerWallet) {
        p.viewer_vote = v.option_id;
      }
    }
  }

  /* ---------- SIGN IMAGES ---------- */

  const posts = await Promise.all(
    rawPosts.map(async (p: any) => ({
      id: p.id,
      wallet: p.wallet,
      content: p.content,
      created_at: p.created_at,
      image_url: await signFromAnyBucket(sb, p.image_path ?? null),
      poll: p.poll_id ? pollMap.get(p.poll_id) ?? null : null
    }))
  );

  /* ---------- COINS ---------- */

  const coinsRes = await sb
    .from("coins")
    .select("id, wallet, token_address, title, description, created_at")
    .in("wallet", devWallets)
    .order("created_at", { ascending: false })
    .limit(40);

  if (coinsRes.error) {
    return NextResponse.json({ error: coinsRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    devWallets,
    posts,
    coins: coinsRes.data ?? []
  });
}
