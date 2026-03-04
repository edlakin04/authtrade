import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DEV_POST_BUCKETS = ["dev-posts", "dev_posts", "posts", "devposts"];

async function signedDevPostImageUrl(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;

  for (const bucket of DEV_POST_BUCKETS) {
    try {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 60 * 30);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      // try next bucket
    }
  }

  return null;
}

type PollOptionOut = {
  id: string;
  label: string;
  votes: number;
};

type PollOut = {
  id: string;
  question: string;
  options: PollOptionOut[];
  viewer_vote?: string | null; // option_id or null
};

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

  // ✅ Posts: include poll_id so we can hydrate the poll
  const postsRes = await sb
    .from("dev_posts")
    .select("id, wallet, content, image_path, poll_id, created_at")
    .eq("wallet", devWallet)
    .order("created_at", { ascending: false })
    .limit(50);

  if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });

  const postsRaw = postsRes.data ?? [];
  const pollIds = Array.from(
    new Set(postsRaw.map((p: any) => (p?.poll_id ? String(p.poll_id) : null)).filter(Boolean))
  ) as string[];

  // ---------- Hydrate polls (question + options + vote counts + viewer_vote) ----------
  const pollById = new Map<string, PollOut>();

  if (pollIds.length) {
    // Poll questions
    const pollsRes = await sb
      .from("dev_post_polls")
      .select("id, question, created_at")
      .in("id", pollIds);

    if (pollsRes.error) return NextResponse.json({ error: pollsRes.error.message }, { status: 500 });

    // Poll options
    const optionsRes = await sb
      .from("dev_post_poll_options")
      .select("id, poll_id, label, sort_order")
      .in("poll_id", pollIds)
      .order("sort_order", { ascending: true });

    if (optionsRes.error) return NextResponse.json({ error: optionsRes.error.message }, { status: 500 });

    // Poll votes
    const votesRes = await sb
      .from("dev_post_poll_votes")
      .select("poll_id, option_id, voter_wallet")
      .in("poll_id", pollIds)
      .limit(20000);

    if (votesRes.error) return NextResponse.json({ error: votesRes.error.message }, { status: 500 });

    // Build: counts[pollId][optionId] = n
    const counts = new Map<string, Map<string, number>>();
    for (const v of votesRes.data ?? []) {
      const pid = String((v as any).poll_id);
      const oid = String((v as any).option_id);
      if (!counts.has(pid)) counts.set(pid, new Map());
      const m = counts.get(pid)!;
      m.set(oid, (m.get(oid) ?? 0) + 1);
    }

    // Viewer vote per poll
    const viewerVote = new Map<string, string>();
    if (viewerWallet) {
      for (const v of votesRes.data ?? []) {
        if (String((v as any).voter_wallet) === viewerWallet) {
          viewerVote.set(String((v as any).poll_id), String((v as any).option_id));
        }
      }
    }

    // Options grouped by poll
    const optionsByPoll = new Map<string, Array<{ id: string; label: string }>>();
    for (const o of optionsRes.data ?? []) {
      const pid = String((o as any).poll_id);
      if (!optionsByPoll.has(pid)) optionsByPoll.set(pid, []);
      optionsByPoll.get(pid)!.push({ id: String((o as any).id), label: String((o as any).label ?? "") });
    }

    // Assemble polls
    for (const p of pollsRes.data ?? []) {
      const pid = String((p as any).id);
      const opts = optionsByPoll.get(pid) ?? [];
      const cMap = counts.get(pid) ?? new Map<string, number>();

      pollById.set(pid, {
        id: pid,
        question: String((p as any).question ?? ""),
        options: opts.map((o) => ({
          id: o.id,
          label: o.label,
          votes: cMap.get(o.id) ?? 0
        })),
        viewer_vote: viewerVote.get(pid) ?? null
      });
    }
  }

  // Sign images + attach poll object
  const posts = await Promise.all(
    postsRaw.map(async (p: any) => {
      const pollId = p?.poll_id ? String(p.poll_id) : null;

      return {
        id: p.id,
        wallet: p.wallet,
        content: p.content, // keep for backwards UI
        created_at: p.created_at,
        image_path: p.image_path ?? null,
        image_url: await signedDevPostImageUrl(sb, p.image_path ?? null),
        poll: pollId ? pollById.get(pollId) ?? null : null
      };
    })
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

  // Followers count (public)
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
