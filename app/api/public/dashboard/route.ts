import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const GOLDEN_HOUR_BUCKET = "golden-hour";
const BIDDING_AD_BUCKET_CANDIDATES = ["bidding-ad-banners", "bidding_ads", "bidding-ad", "biddingad"];

function expDecayWeight(ageHours: number, halfLifeHours = 6) {
  return Math.exp((-Math.LN2 * ageHours) / halfLifeHours);
}

function safeDateMs(v: any): number | null {
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

type DevPostRow = {
  id: string;
  wallet: string;
  content: string | null;
  image_path: string | null;
  poll_id: string | null;
  created_at: string;
};

type PollRow = {
  id: string;
  wallet: string;
  question: string;
  created_at: string;
};

type PollOptionRow = {
  id: string;
  poll_id: string;
  label: string;
  sort_order: number;
  created_at: string;
};

type PollVoteRow = {
  poll_id: string;
  option_id: string;
  voter_wallet: string;
  created_at: string;
};

type DashboardAd = {
  id: string;
  kind: "golden_hour" | "paid_ad";
  dev_wallet: string;
  coin_id: string;
  banner_url: string | null;
  starts_at: string;
  ends_at: string;
  target_date: string;
  coin: {
    id: string;
    wallet: string;
    token_address: string;
    title: string | null;
    description: string | null;
  } | null;
  profile: {
    wallet: string;
    display_name: string | null;
  } | null;
};

async function getViewerWallet(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionToken) return null;
    const session = await readSessionToken(sessionToken).catch(() => null);
    return session?.wallet ?? null;
  } catch {
    return null;
  }
}

async function createSignedUrlFromAnyBucket(
  sb: ReturnType<typeof supabaseAdmin>,
  path: string | null | undefined,
  buckets: string[],
  expiresInSeconds = 60 * 30
) {
  if (!path) return null;

  for (const bucket of buckets) {
    try {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      // ignore and try next bucket
    }
  }

  return null;
}

async function getActiveGoldenHourAd(
  sb: ReturnType<typeof supabaseAdmin>,
  nowIso: string
): Promise<DashboardAd | null> {
  try {
    const activeGoldenRes = await sb
      .from("golden_hour_winners")
      .select("id, target_date, dev_wallet, coin_id, banner_path, starts_at, ends_at")
      .lte("starts_at", nowIso)
      .gt("ends_at", nowIso)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeGoldenRes.error || !activeGoldenRes.data) return null;

    const gh = activeGoldenRes.data as any;

    const [{ data: coin }, { data: profile }, bannerUrl] = await Promise.all([
      sb
        .from("coins")
        .select("id, wallet, token_address, title, description")
        .eq("id", gh.coin_id)
        .maybeSingle(),
      sb
        .from("dev_profiles")
        .select("wallet, display_name")
        .eq("wallet", gh.dev_wallet)
        .maybeSingle(),
      createSignedUrlFromAnyBucket(sb, String(gh.banner_path), [GOLDEN_HOUR_BUCKET])
    ]);

    return {
      id: String(gh.id),
      kind: "golden_hour",
      dev_wallet: String(gh.dev_wallet),
      coin_id: String(gh.coin_id),
      banner_url: bannerUrl,
      starts_at: String(gh.starts_at),
      ends_at: String(gh.ends_at),
      target_date: String(gh.target_date),
      coin: coin
        ? {
            id: String((coin as any).id),
            wallet: String((coin as any).wallet),
            token_address: String((coin as any).token_address),
            title: (coin as any).title ?? null,
            description: (coin as any).description ?? null
          }
        : null,
      profile: profile
        ? {
            wallet: String((profile as any).wallet),
            display_name: (profile as any).display_name ?? null
          }
        : null
    };
  } catch {
    return null;
  }
}

async function getActivePaidAd(
  sb: ReturnType<typeof supabaseAdmin>,
  nowIso: string
): Promise<DashboardAd | null> {
  try {
    const activePaidRes = await sb
      .from("bidding_ad_winners")
      .select(
        "id, target_date, dev_wallet, coin_id, banner_path, ad_starts_at, ad_ends_at, payment_confirmed_at"
      )
      .not("payment_confirmed_at", "is", null)
      .lte("ad_starts_at", nowIso)
      .gt("ad_ends_at", nowIso)
      .order("ad_starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activePaidRes.error || !activePaidRes.data) return null;

    const ad = activePaidRes.data as any;

    const [{ data: coin }, { data: profile }, bannerUrl] = await Promise.all([
      sb
        .from("coins")
        .select("id, wallet, token_address, title, description")
        .eq("id", ad.coin_id)
        .maybeSingle(),
      sb
        .from("dev_profiles")
        .select("wallet, display_name")
        .eq("wallet", ad.dev_wallet)
        .maybeSingle(),
      createSignedUrlFromAnyBucket(sb, String(ad.banner_path), BIDDING_AD_BUCKET_CANDIDATES)
    ]);

    return {
      id: String(ad.id),
      kind: "paid_ad",
      dev_wallet: String(ad.dev_wallet),
      coin_id: String(ad.coin_id),
      banner_url: bannerUrl,
      starts_at: String(ad.ad_starts_at),
      ends_at: String(ad.ad_ends_at),
      target_date: String(ad.target_date),
      coin: coin
        ? {
            id: String((coin as any).id),
            wallet: String((coin as any).wallet),
            token_address: String((coin as any).token_address),
            title: (coin as any).title ?? null,
            description: (coin as any).description ?? null
          }
        : null,
      profile: profile
        ? {
            wallet: String((profile as any).wallet),
            display_name: (profile as any).display_name ?? null
          }
        : null
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const sb = supabaseAdmin();

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const sinceFollows7d = new Date(now - 7 * DAY).toISOString();
    const sinceReviews14d = new Date(now - 14 * DAY).toISOString();
    const sinceReviews90d = new Date(now - 90 * DAY).toISOString();
    const sinceCoins14d = new Date(now - 14 * DAY).toISOString();
    const sinceVotes48h = new Date(now - 48 * HOUR).toISOString();

    const profilesRes = await sb
      .from("dev_profiles")
      .select("wallet, display_name, bio, pfp_url, x_url, updated_at")
      .limit(250);

    if (profilesRes.error) {
      return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
    }

    const profiles = profilesRes.data ?? [];
    const devWallets = profiles.map((p) => p.wallet);

    const followsRes = await sb
      .from("follows")
      .select("dev_wallet, created_at")
      .in("dev_wallet", devWallets)
      .gte("created_at", sinceFollows7d)
      .limit(10000);

    const reviewsRes = await sb
      .from("dev_reviews")
      .select("dev_wallet, rating, created_at")
      .in("dev_wallet", devWallets)
      .gte("created_at", sinceReviews90d)
      .limit(10000);

    const coinsByDevRes = await sb
      .from("coins")
      .select("id, wallet, created_at")
      .in("wallet", devWallets)
      .gte("created_at", sinceCoins14d)
      .limit(1500);

    let coinVotesRes: { data: any[] | null; error: any } = { data: null, error: null };
    const coinIds = (coinsByDevRes.data ?? []).map((c) => c.id);

    if (!coinsByDevRes.error && coinIds.length) {
      coinVotesRes = await sb
        .from("coin_votes")
        .select("coin_id, created_at")
        .in("coin_id", coinIds)
        .gte("created_at", sinceVotes48h)
        .limit(20000);
    }

    const follows7d = new Map<string, number>();
    if (!followsRes.error) {
      for (const f of followsRes.data ?? []) {
        const w = String((f as any).dev_wallet);
        follows7d.set(w, (follows7d.get(w) ?? 0) + 1);
      }
    }

    const reviewCount90d = new Map<string, number>();
    const reviewSum90d = new Map<string, number>();
    const reviewCount14d = new Map<string, number>();

    if (!reviewsRes.error) {
      const since14ms = Date.parse(sinceReviews14d);

      for (const r of reviewsRes.data ?? []) {
        const w = String((r as any).dev_wallet);
        const rating = Number((r as any).rating) || 0;

        reviewCount90d.set(w, (reviewCount90d.get(w) ?? 0) + 1);
        reviewSum90d.set(w, (reviewSum90d.get(w) ?? 0) + rating);

        const ms = safeDateMs((r as any).created_at);
        if (ms && ms >= since14ms) {
          reviewCount14d.set(w, (reviewCount14d.get(w) ?? 0) + 1);
        }
      }
    }

    const coinToDev = new Map<string, string>();
    for (const c of coinsByDevRes.data ?? []) {
      coinToDev.set(String((c as any).id), String((c as any).wallet));
    }

    const coinDecay = new Map<string, number>();
    if (!coinVotesRes.error) {
      for (const v of coinVotesRes.data ?? []) {
        const coinId = String((v as any).coin_id);
        const ms = safeDateMs((v as any).created_at);
        if (!ms) continue;

        const ageHrs = (now - ms) / HOUR;
        if (ageHrs < 0 || ageHrs > 48) continue;

        const w = expDecayWeight(ageHrs, 6);
        coinDecay.set(coinId, (coinDecay.get(coinId) ?? 0) + w);
      }
    }

    const devCoinScore = new Map<string, number>();
    for (const [coinId, decayScore] of coinDecay.entries()) {
      const dev = coinToDev.get(coinId);
      if (!dev) continue;
      devCoinScore.set(dev, (devCoinScore.get(dev) ?? 0) + decayScore);
    }

    for (const [dev, score] of devCoinScore.entries()) {
      devCoinScore.set(dev, Math.min(10, score));
    }

    const scoredProfiles = profiles
      .map((p) => {
        const w = p.wallet;

        const f7 = follows7d.get(w) ?? 0;
        const follow_score = Math.log1p(f7) * 3;

        const c90 = reviewCount90d.get(w) ?? 0;
        const s90 = reviewSum90d.get(w) ?? 0;
        const avg90 = c90 > 0 ? s90 / c90 : null;

        const priorMean = 3.5;
        const priorWeight = 5;
        const rating_adj =
          c90 > 0 ? (avg90! * c90 + priorMean * priorWeight) / (c90 + priorWeight) : priorMean;

        const r14 = reviewCount14d.get(w) ?? 0;
        const review_score = Math.log1p(r14) * rating_adj;

        const coin_score = devCoinScore.get(w) ?? 0;
        const trending_score = follow_score + review_score + coin_score;

        return {
          ...p,
          trending_score,
          follows_7d: f7,
          reviews_14d: r14,
          avg_rating_90d: avg90,
          rating_adj,
          coin_score
        };
      })
      .sort((a, b) => (b.trending_score ?? 0) - (a.trending_score ?? 0))
      .slice(0, 12);

    const [goldenHourAd, paidAd] = await Promise.all([
      getActiveGoldenHourAd(sb, nowIso),
      getActivePaidAd(sb, nowIso)
    ]);

    const activeAd = goldenHourAd ?? paidAd ?? null;

    const postsRes = await sb
      .from("dev_posts")
      .select("id, wallet, content, image_path, poll_id, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    const coinsRes = await sb
      .from("coins")
      .select("id, wallet, token_address, title, description, created_at")
      .order("created_at", { ascending: false })
      .limit(30);

    if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });
    if (coinsRes.error) return NextResponse.json({ error: coinsRes.error.message }, { status: 500 });

    const bucketCandidates = ["dev_posts", "dev-posts", "posts", "devposts", "community"];

    async function signFromAnyBucket(path?: string | null) {
      if (!path) return null;

      for (const bucket of bucketCandidates) {
        try {
          const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 60 * 30);
          if (!error && data?.signedUrl) return data.signedUrl;
        } catch {
          // ignore and try next bucket
        }
      }
      return null;
    }

    const rawPosts = (postsRes.data ?? []) as DevPostRow[];

    const signedUrlById = new Map<string, string | null>();
    await Promise.all(
      rawPosts.map(async (p) => {
        const url = await signFromAnyBucket(p?.image_path ?? null);
        signedUrlById.set(String(p.id), url);
      })
    );

    const viewerWallet = await getViewerWallet();

    const pollIds = Array.from(
      new Set(rawPosts.map((p) => (p.poll_id ? String(p.poll_id) : null)).filter(Boolean) as string[])
    );

    const pollById = new Map<string, PollRow>();
    const optionsByPollId = new Map<string, PollOptionRow[]>();
    const countsByPollId = new Map<string, Map<string, number>>();
    const viewerVoteByPollId = new Map<string, string | null>();

    if (pollIds.length) {
      const pollsRes = await sb
        .from("dev_post_polls")
        .select("id, wallet, question, created_at")
        .in("id", pollIds);

      if (!pollsRes.error) {
        for (const p of (pollsRes.data ?? []) as PollRow[]) pollById.set(String(p.id), p);
      }

      const optsRes = await sb
        .from("dev_post_poll_options")
        .select("id, poll_id, label, sort_order, created_at")
        .in("poll_id", pollIds)
        .order("sort_order", { ascending: true });

      if (!optsRes.error) {
        for (const o of (optsRes.data ?? []) as PollOptionRow[]) {
          const pid = String(o.poll_id);
          if (!optionsByPollId.has(pid)) optionsByPollId.set(pid, []);
          optionsByPollId.get(pid)!.push(o);
        }
      }

      const votesRes = await sb
        .from("dev_post_poll_votes")
        .select("poll_id, option_id, voter_wallet, created_at")
        .in("poll_id", pollIds)
        .limit(20000);

      if (!votesRes.error) {
        const votes = (votesRes.data ?? []) as PollVoteRow[];
        for (const v of votes) {
          const pid = String(v.poll_id);
          const oid = String(v.option_id);

          if (!countsByPollId.has(pid)) countsByPollId.set(pid, new Map());
          const m = countsByPollId.get(pid)!;
          m.set(oid, (m.get(oid) ?? 0) + 1);

          if (viewerWallet && String(v.voter_wallet) === viewerWallet) {
            viewerVoteByPollId.set(pid, oid);
          }
        }
      }
    }

    const posts = rawPosts.map((p) => {
      const pollId = p.poll_id ? String(p.poll_id) : null;

      const pollRow = pollId ? pollById.get(pollId) ?? null : null;
      const optionRows = pollId ? optionsByPollId.get(pollId) ?? [] : [];
      const counts = pollId ? countsByPollId.get(pollId) ?? new Map() : new Map();
      const viewerVote = pollId ? viewerVoteByPollId.get(pollId) ?? null : null;

      return {
        id: p.id,
        wallet: p.wallet,
        content: p.content,
        created_at: p.created_at,
        image_url: signedUrlById.get(String(p.id)) ?? null,
        poll:
          pollRow && optionRows.length
            ? {
                id: pollRow.id,
                question: pollRow.question,
                options: optionRows.map((o) => ({
                  id: o.id,
                  label: o.label,
                  votes: counts.get(String(o.id)) ?? 0
                })),
                viewer_vote: viewerVote
              }
            : null
      };
    });

    return NextResponse.json({
      ok: true,
      goldenHourAd: activeAd,
      adKind: activeAd?.kind ?? null,
      profiles: scoredProfiles,
      posts,
      coins: coinsRes.data ?? []
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load dashboard", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
