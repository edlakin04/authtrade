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
    try {
      const { data, error } = await sb.storage.from(b).createSignedUrl(path, 60 * 30);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      // ignore and try next
    }
  }

  return null;
}

type Poll = {
  id: string;
  question: string;
  options: Array<{ id: string; label: string; votes: number }>;
  viewer_vote?: string | null;
};

export async function GET() {
  const viewerWallet = await getViewerWallet();
  if (!viewerWallet) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  /* ---------------- FOLLOWED DEVS ---------------- */

  const followsRes = await sb.from("follows").select("dev_wallet").eq("follower_wallet", viewerWallet);

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

  /* ---------------- DEV POSTS ---------------- */

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

  /* ---------------- POLL DATA (hydrate via dev_posts.poll_id) ---------------- */

  const pollIds = Array.from(
    new Set(rawPosts.map((p: any) => (p.poll_id ? String(p.poll_id) : null)).filter(Boolean) as string[])
  );

  const pollMap = new Map<string, Poll>();

  if (pollIds.length) {
    // polls
    const pollsRes = await sb.from("dev_post_polls").select("id, question").in("id", pollIds);

    if (!pollsRes.error) {
      for (const p of pollsRes.data ?? []) {
        pollMap.set(String((p as any).id), {
          id: String((p as any).id),
          question: String((p as any).question ?? ""),
          options: [],
          viewer_vote: null
        });
      }
    }

    // options (sorted)
    const optionsRes = await sb
      .from("dev_post_poll_options")
      .select("id, poll_id, label, sort_order")
      .in("poll_id", pollIds)
      .order("sort_order", { ascending: true });

    if (!optionsRes.error) {
      for (const o of optionsRes.data ?? []) {
        const pid = String((o as any).poll_id);
        const poll = pollMap.get(pid);
        if (!poll) continue;

        poll.options.push({
          id: String((o as any).id),
          label: String((o as any).label ?? ""),
          votes: 0
        });
      }
    }

    // votes (aggregate)
    const votesRes = await sb
      .from("dev_post_poll_votes")
      .select("poll_id, option_id, voter_wallet")
      .in("poll_id", pollIds)
      .limit(20000);

    if (!votesRes.error) {
      // build a quick lookup: poll_id -> (option_id -> count)
      const countsByPoll = new Map<string, Map<string, number>>();

      for (const v of votesRes.data ?? []) {
        const pid = String((v as any).poll_id);
        const oid = String((v as any).option_id);

        if (!countsByPoll.has(pid)) countsByPoll.set(pid, new Map());
        const m = countsByPoll.get(pid)!;
        m.set(oid, (m.get(oid) ?? 0) + 1);

        if (String((v as any).voter_wallet) === viewerWallet) {
          const poll = pollMap.get(pid);
          if (poll) poll.viewer_vote = oid;
        }
      }

      // apply counts to options
      for (const [pid, poll] of pollMap.entries()) {
        const counts = countsByPoll.get(pid);
        if (!counts) continue;

        poll.options = poll.options.map((opt) => ({
          ...opt,
          votes: counts.get(opt.id) ?? 0
        }));
      }
    }
  }

  /* ---------------- SIGN IMAGES ---------------- */

  const posts = await Promise.all(
    rawPosts.map(async (p: any) => ({
      id: p.id,
      wallet: p.wallet,
      content: p.content,
      created_at: p.created_at,
      image_url: await signFromAnyBucket(sb, p.image_path ?? null),
      poll: p.poll_id ? pollMap.get(String(p.poll_id)) ?? null : null
    }))
  );

  /* ---------------- COINS ---------------- */

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
