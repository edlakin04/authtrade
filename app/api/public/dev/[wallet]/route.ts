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

type PollOption = { id: string; text: string };
type PollRow = {
  id: string;
  wallet: string;
  question: string;
  options: PollOption[] | any; // stored as jsonb
  created_at: string;
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

  // ---- NORMAL POSTS ----
  const postsRes = await sb
    .from("dev_posts")
    .select("id, wallet, content, image_path, created_at")
    .eq("wallet", devWallet)
    .order("created_at", { ascending: false })
    .limit(50);

  if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });

  const postsRaw = postsRes.data ?? [];

  const posts = await Promise.all(
    postsRaw.map(async (p: any) => ({
      id: p.id,
      wallet: p.wallet,
      type: "post" as const,
      content: p.content,
      created_at: p.created_at,
      image_path: p.image_path ?? null,
      image_url: await signedDevPostImageUrl(sb, p.image_path ?? null)
    }))
  );

  // ---- DEV POST POLLS (Updates Polls) ----
  // Expected tables (from the poll system you added):
  //   dev_post_polls: id, wallet, question, options(jsonb), created_at
  //   dev_post_poll_votes: id, poll_id, voter_wallet, option_id OR option_index, created_at
  //
  // This route is defensive: it supports either option_id or option_index vote schemas.
  let polls: any[] = [];
  try {
    const pollsRes = await sb
      .from("dev_post_polls")
      .select("id, wallet, question, options, created_at")
      .eq("wallet", devWallet)
      .order("created_at", { ascending: false })
      .limit(50);

    if (pollsRes.error) throw pollsRes.error;

    const pollRows = (pollsRes.data ?? []) as PollRow[];
    const pollIds = pollRows.map((p) => String(p.id));

    // vote aggregation
    let votes: any[] = [];
    if (pollIds.length) {
      const votesRes = await sb
        .from("dev_post_poll_votes")
        .select("poll_id, voter_wallet, option_id, option_index")
        .in("poll_id", pollIds)
        .limit(20000);

      if (!votesRes.error) votes = votesRes.data ?? [];
    }

    // counts per poll + option (id or index)
    const countsByPoll = new Map<string, Map<string, number>>();
    const countsByPollIndex = new Map<string, Map<number, number>>();
    const viewerChoiceByPoll = new Map<string, { option_id?: string; option_index?: number }>();

    for (const v of votes) {
      const pid = String((v as any).poll_id);

      const optId = (v as any).option_id ? String((v as any).option_id) : null;
      const optIndex =
        typeof (v as any).option_index === "number" ? Number((v as any).option_index) : null;

      if (optId) {
        if (!countsByPoll.has(pid)) countsByPoll.set(pid, new Map());
        const m = countsByPoll.get(pid)!;
        m.set(optId, (m.get(optId) ?? 0) + 1);
      } else if (optIndex != null) {
        if (!countsByPollIndex.has(pid)) countsByPollIndex.set(pid, new Map());
        const m = countsByPollIndex.get(pid)!;
        m.set(optIndex, (m.get(optIndex) ?? 0) + 1);
      }

      if (viewerWallet && (v as any).voter_wallet && String((v as any).voter_wallet) === viewerWallet) {
        viewerChoiceByPoll.set(pid, {
          option_id: optId ?? undefined,
          option_index: optIndex ?? undefined
        });
      }
    }

    polls = pollRows.map((p) => {
      const pid = String(p.id);

      const optionsRaw = Array.isArray(p.options) ? p.options : [];
      const normalizedOptions: Array<{ id?: string; text?: string; count: number; index?: number }> =
        optionsRaw.map((o: any, idx: number) => {
          const oid = o?.id ? String(o.id) : undefined;
          const txt = typeof o?.text === "string" ? o.text : String(o ?? "");
          const byIdCount = oid ? countsByPoll.get(pid)?.get(oid) ?? 0 : 0;
          const byIndexCount = countsByPollIndex.get(pid)?.get(idx) ?? 0;
          return { id: oid, text: txt, count: oid ? byIdCount : byIndexCount, index: idx };
        });

      const viewerChoice = viewerChoiceByPoll.get(pid) ?? null;

      return {
        id: p.id,
        wallet: p.wallet,
        type: "poll" as const,
        // IMPORTANT: keep `content` non-null so your existing UI doesn’t break
        // (your UI already renders `p.content`)
        content: p.question,
        created_at: p.created_at,
        poll: {
          id: p.id,
          question: p.question,
          options: normalizedOptions,
          viewer_choice: viewerChoice
        }
      };
    });
  } catch {
    // If poll tables aren't present yet, just omit polls (don’t break the whole dev page)
    polls = [];
  }

  // Merge updates (posts + polls) sorted
  const updates = [...polls, ...posts]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50);

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
    // ✅ IMPORTANT: keep the key name `posts` because your UI uses `data.posts`
    // We now return posts + polls mixed, with `type` to distinguish them.
    posts: updates,
    coins: coinsRes.data ?? []
  });
}
