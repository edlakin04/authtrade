import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function signedDevPostImageUrl(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;
  const { data } = await sb.storage.from("dev-posts").createSignedUrl(path, 60 * 30);
  return data?.signedUrl ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const devWallet = (wallet ?? "").trim();

  if (!devWallet) {
    return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  /* ---------- viewer wallet ---------- */

  let viewerWallet: string | null = null;

  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (sessionToken) {
      const session = await readSessionToken(sessionToken).catch(() => null);
      if (session?.wallet) viewerWallet = session.wallet;
    }
  } catch {}

  /* ---------- dev profile ---------- */

  const profileRes = await sb
    .from("dev_profiles")
    .select("wallet, display_name, bio, pfp_url, x_url, created_at, updated_at")
    .eq("wallet", devWallet)
    .maybeSingle();

  if (profileRes.error) {
    return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  }

  if (!profileRes.data) {
    return NextResponse.json({ error: "Dev profile not found" }, { status: 404 });
  }

  /* ---------- dev posts ---------- */

  const postsRes = await sb
    .from("dev_posts")
    .select("id, wallet, content, image_path, poll_id, created_at")
    .eq("wallet", devWallet)
    .order("created_at", { ascending: false })
    .limit(50);

  if (postsRes.error) {
    return NextResponse.json({ error: postsRes.error.message }, { status: 500 });
  }

  const postsRaw = postsRes.data ?? [];

  /* ---------- poll data ---------- */

  const pollIds = postsRaw.map((p: any) => p.poll_id).filter(Boolean);

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

      if (viewerWallet && v.voter_wallet === viewerWallet) {
        p.viewer_vote = v.option_id;
      }
    }
  }

  /* ---------- sign images ---------- */

  const posts = await Promise.all(
    postsRaw.map(async (p: any) => ({
      id: p.id,
      wallet: p.wallet,
      content: p.content,
      created_at: p.created_at,
      image_path: p.image_path ?? null,
      image_url: await signedDevPostImageUrl(sb, p.image_path ?? null),
      poll: p.poll_id ? pollMap.get(p.poll_id) ?? null : null
    }))
  );

  /* ---------- coins ---------- */

  const coinsRes = await sb
    .from("coins")
    .select("id, wallet, token_address, title, description, created_at")
    .eq("wallet", devWallet)
    .order("created_at", { ascending: false })
    .limit(100);

  if (coinsRes.error) {
    return NextResponse.json({ error: coinsRes.error.message }, { status: 500 });
  }

  /* ---------- follow status ---------- */

  let isFollowing = false;

  if (viewerWallet) {
    const followRes = await sb
      .from("follows")
      .select("follower_wallet")
      .eq("follower_wallet", viewerWallet)
      .eq("dev_wallet", devWallet)
      .maybeSingle();

    if (!followRes.error && followRes.data) {
      isFollowing = true;
    }
  }

  return NextResponse.json({
    ok: true,
    viewerWallet,
    isFollowing,
    profile: profileRes.data,
    posts,
    coins: coinsRes.data ?? []
  });
}
