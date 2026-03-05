import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

async function requireWallet() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  return await readSessionToken(sessionToken).catch(() => null);
}

/**
 * Dev detection:
 * - dev_profiles row = dev (most reliable for your UI)
 * - OR users.role dev/admin (keeps role support)
 */
async function requireDev(wallet: string) {
  const sb = supabaseAdmin();

  const prof = await sb.from("dev_profiles").select("wallet").eq("wallet", wallet).maybeSingle();
  if (!prof.error && prof.data?.wallet) return true;

  const u = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle();
  const role = (u.data?.role ?? null) as string | null;
  return role === "dev" || role === "admin";
}

// Try multiple bucket names so env differences don’t break images
const DEV_POST_BUCKETS = ["dev-posts", "dev_posts", "posts", "devposts"];

// ✅ banner bucket candidates (your chosen bucket is "dev-banners")
const DEV_BANNER_BUCKETS = ["dev-banners", "dev_banners", "devbanners", "banners"];

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

async function signedDevBannerUrl(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;

  for (const bucket of DEV_BANNER_BUCKETS) {
    try {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 60 * 30);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      // try next bucket
    }
  }

  return null;
}

type HydratedPoll = {
  id: string;
  question: string;
  options: Array<{ id: string; label: string; votes: number }>;
  viewer_vote?: string | null;
};

async function hydrateDevPostPolls(sb: ReturnType<typeof supabaseAdmin>, pollIds: string[], viewerWallet: string) {
  const uniq = Array.from(new Set(pollIds.filter(Boolean)));
  if (uniq.length === 0) return new Map<string, HydratedPoll>();

  // Poll rows
  const pollsRes = await sb.from("dev_post_polls").select("id, question").in("id", uniq);
  if (pollsRes.error) throw new Error(pollsRes.error.message);

  // Options
  const optsRes = await sb
    .from("dev_post_poll_options")
    .select("id, poll_id, label, sort_order")
    .in("poll_id", uniq)
    .order("sort_order", { ascending: true });

  if (optsRes.error) throw new Error(optsRes.error.message);

  // Votes (we’ll count in JS)
  const votesRes = await sb.from("dev_post_poll_votes").select("poll_id, option_id").in("poll_id", uniq);
  if (votesRes.error) throw new Error(votesRes.error.message);

  // Viewer vote (at most 1 per poll)
  const viewerVotesRes = await sb
    .from("dev_post_poll_votes")
    .select("poll_id, option_id")
    .in("poll_id", uniq)
    .eq("voter_wallet", viewerWallet);

  if (viewerVotesRes.error) throw new Error(viewerVotesRes.error.message);

  const votes = votesRes.data ?? [];
  const voteCountByOption = new Map<string, number>();
  for (const v of votes as any[]) {
    const optId = String(v.option_id);
    voteCountByOption.set(optId, (voteCountByOption.get(optId) ?? 0) + 1);
  }

  const viewerVoteByPoll = new Map<string, string>();
  for (const v of (viewerVotesRes.data ?? []) as any[]) {
    viewerVoteByPoll.set(String(v.poll_id), String(v.option_id));
  }

  const optionsByPoll = new Map<string, Array<{ id: string; label: string; votes: number; sort_order: number }>>();
  for (const o of (optsRes.data ?? []) as any[]) {
    const pid = String(o.poll_id);
    const arr = optionsByPoll.get(pid) ?? [];
    arr.push({
      id: String(o.id),
      label: String(o.label ?? ""),
      votes: voteCountByOption.get(String(o.id)) ?? 0,
      sort_order: Number(o.sort_order) || 0
    });
    optionsByPoll.set(pid, arr);
  }

  // Build final map
  const out = new Map<string, HydratedPoll>();
  for (const p of (pollsRes.data ?? []) as any[]) {
    const id = String(p.id);
    const opts = (optionsByPoll.get(id) ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    out.set(id, {
      id,
      question: String(p.question ?? ""),
      options: opts.map((x) => ({ id: x.id, label: x.label, votes: x.votes })),
      viewer_vote: viewerVoteByPoll.get(id) ?? null
    });
  }

  return out;
}

export async function GET() {
  const session = await requireWallet();
  if (!session?.wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!(await requireDev(session.wallet))) {
    return NextResponse.json({ error: "Not a dev" }, { status: 403 });
  }

  const sb = supabaseAdmin();

  // ✅ include banner_path so UI can show banner in dev profile page
  const profileRes = await sb
    .from("dev_profiles")
    .select("*")
    .eq("wallet", session.wallet)
    .maybeSingle();

  const coinsRes = await sb
    .from("coins")
    .select("*")
    .eq("wallet", session.wallet)
    .order("created_at", { ascending: false });

  // IMPORTANT: include poll_id + image_path so we can hydrate polls + sign images
  const postsRes = await sb
    .from("dev_posts")
    .select("*")
    .eq("wallet", session.wallet)
    .order("created_at", { ascending: false });

  if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  if (coinsRes.error) return NextResponse.json({ error: coinsRes.error.message }, { status: 500 });
  if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });

  const postsRaw = postsRes.data ?? [];

  // ✅ hydrate polls in one go
  const pollIds = postsRaw.map((p: any) => (p?.poll_id ? String(p.poll_id) : "")).filter(Boolean);
  let pollById = new Map<string, HydratedPoll>();
  try {
    pollById = await hydrateDevPostPolls(sb, pollIds, session.wallet);
  } catch {
    // If poll hydration fails, don’t break the whole page — just omit polls
    pollById = new Map();
  }

  const posts = await Promise.all(
    postsRaw.map(async (p: any) => {
      const pollId = p?.poll_id ? String(p.poll_id) : null;

      return {
        ...p,
        image_url: await signedDevPostImageUrl(sb, p.image_path ?? null),
        poll: pollId ? pollById.get(pollId) ?? null : null
      };
    })
  );

  // ✅ sign banner (non-breaking: adds banner_url)
  const banner_url = await signedDevBannerUrl(sb, (profileRes.data as any)?.banner_path ?? null);

  return NextResponse.json({
    ok: true,
    profile: profileRes.data ? { ...(profileRes.data as any), banner_url } : null,
    coins: coinsRes.data ?? [],
    posts
  });
}

export async function PUT(req: Request) {
  const session = await requireWallet();
  if (!session?.wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!(await requireDev(session.wallet))) {
    return NextResponse.json({ error: "Not a dev" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  const display_name = (body?.display_name as string | undefined)?.trim();
  const bio = (body?.bio as string | undefined)?.trim() ?? null;
  const pfp_url = (body?.pfp_url as string | undefined)?.trim() ?? null;
  const x_url = (body?.x_url as string | undefined)?.trim() ?? null;

  if (!display_name) {
    return NextResponse.json({ error: "Display name required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("dev_profiles").upsert({
    wallet: session.wallet,
    display_name,
    bio,
    pfp_url,
    x_url,
    updated_at: new Date().toISOString()
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await requireWallet();
  if (!session?.wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!(await requireDev(session.wallet))) {
    return NextResponse.json({ error: "Not a dev" }, { status: 403 });
  }

  const sb = supabaseAdmin();

  await sb.from("coins").delete().eq("wallet", session.wallet);
  await sb.from("dev_posts").delete().eq("wallet", session.wallet);
  await sb.from("dev_profiles").delete().eq("wallet", session.wallet);

  return NextResponse.json({ ok: true });
}
