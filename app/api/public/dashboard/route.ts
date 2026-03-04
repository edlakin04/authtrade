import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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
  created_at: string;
};

type DevPostPollRow = {
  id: string;
  post_id: string;
  question: string;
  created_at: string;
  // If your table has more fields, we keep it flexible
  [k: string]: any;
};

export async function GET() {
  try {
    const sb = supabaseAdmin();

    const now = Date.now();
    const sinceFollows7d = new Date(now - 7 * DAY).toISOString();
    const sinceReviews14d = new Date(now - 14 * DAY).toISOString();
    const sinceReviews90d = new Date(now - 90 * DAY).toISOString();
    const sinceCoins14d = new Date(now - 14 * DAY).toISOString();
    const sinceVotes48h = new Date(now - 48 * HOUR).toISOString();

    // --- Load dev profiles (candidate pool) ---
    const profilesRes = await sb
      .from("dev_profiles")
      .select("wallet, display_name, bio, pfp_url, x_url, updated_at")
      .limit(250);

    if (profilesRes.error) {
      return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
    }

    const profiles = profilesRes.data ?? [];
    const devWallets = profiles.map((p) => p.wallet);

    // --- Trending signals ---
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

    // --- Build maps ---
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

    // Coin traction: compute decayed vote score per coin, then sum per dev (cap)
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

    // --- Compute final dev trending score ---
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

    // --- Posts + coins ---
    // Keep this EXACTLY like before (so dashboard doesn't break)
    const postsRes = await sb
      .from("dev_posts")
      .select("id, wallet, content, image_path, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    const coinsRes = await sb
      .from("coins")
      .select("id, wallet, token_address, title, description, created_at")
      .order("created_at", { ascending: false })
      .limit(30);

    if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });
    if (coinsRes.error) return NextResponse.json({ error: coinsRes.error.message }, { status: 500 });

    // ✅ sign post images
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

    // -------------------------
    // ✅ ADD DEV POST POLLS (non-breaking)
    // We DO NOT join in a way that can filter posts.
    // We fetch polls separately and attach poll info to matching posts.
    // -------------------------
    let pollsByPostId = new Map<string, DevPostPollRow>();

    try {
      const pollsRes = await sb
        .from("dev_post_polls")
        .select("id, post_id, question, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (!pollsRes.error) {
        for (const row of (pollsRes.data ?? []) as DevPostPollRow[]) {
          if (row?.post_id) pollsByPostId.set(String(row.post_id), row);
        }
      }
    } catch {
      // If polls table doesn't exist yet in some env, don't break dashboard.
      pollsByPostId = new Map();
    }

    const posts = rawPosts.map((p) => {
      const poll = pollsByPostId.get(String(p.id)) ?? null;

      return {
        id: p.id,
        wallet: p.wallet,
        // IMPORTANT: keep `content` in the payload exactly like before.
        // (If your DB guarantees content NOT NULL, this is always a string anyway.)
        content: p.content,
        created_at: p.created_at,
        image_url: signedUrlById.get(String(p.id)) ?? null,

        // ✅ extra (safe): dashboard can ignore it
        poll: poll
          ? {
              id: poll.id,
              question: poll.question,
              created_at: poll.created_at
            }
          : null
      };
    });

    return NextResponse.json({
      ok: true,
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
