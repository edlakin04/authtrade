import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Role = "user" | "dev" | "admin";

async function getViewerWalletAndRole() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return { wallet: null as string | null, role: "user" as Role };

  const session = await readSessionToken(token).catch(() => null);
  if (!session?.wallet) return { wallet: null as string | null, role: "user" as Role };

  const sb = supabaseAdmin();
  const { data: user } = await sb
    .from("users")
    .select("wallet, role")
    .eq("wallet", session.wallet)
    .maybeSingle();

  return { wallet: session.wallet, role: (user?.role ?? "user") as Role };
}

// --- Trending helpers (no DB changes required) ---
const HOUR = 60 * 60 * 1000;

function expDecayWeight(ageHours: number, halfLifeHours = 6) {
  // weight halves every halfLifeHours
  // exp(-age/halfLife) gives a smooth decay; halflife-style would be exp(-ln2*age/halfLife)
  // We'll use true half-life:
  return Math.exp((-Math.LN2 * ageHours) / halfLifeHours);
}

function safeDateMs(v: any): number | null {
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // optional query params
    const sort = (url.searchParams.get("sort") || "trending").toLowerCase(); // trending | newest
    const q = (url.searchParams.get("q") || "").trim();

    const { wallet: viewerWallet, role: viewerRole } = await getViewerWalletAndRole();
    const sb = supabaseAdmin();

    // Pull base coin rows from your existing view
    let query = sb
      .from("coins_with_stats")
      .select(
        "id, dev_wallet, token_address, title, description, created_at, upvotes_count, upvotes_24h, comments_count"
      );

    if (q) {
      query = query.or(`token_address.ilike.%${q}%,title.ilike.%${q}%`);
    }

    // For newest: keep pure newest ordering.
    // For trending: we still order roughly to limit payload, but final order is computed in JS.
    if (sort === "newest") {
      query = query.order("created_at", { ascending: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    const { data: coins, error } = await query.limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const coinList = (coins ?? []) as any[];

    // viewer_has_upvoted map
    let votedSet = new Set<string>();
    if (viewerWallet && coinList.length) {
      const ids = coinList.map((c) => c.id);
      const { data: votes, error: vErr } = await sb
        .from("coin_votes")
        .select("coin_id")
        .eq("voter_wallet", viewerWallet)
        .in("coin_id", ids);

      if (!vErr && votes) votedSet = new Set(votes.map((v: any) => v.coin_id));
    }

    // If not trending, just return as-is (with viewer_has_upvoted)
    if (sort === "newest") {
      const out = coinList.map((c: any) => ({
        ...c,
        viewer_has_upvoted: viewerWallet ? votedSet.has(c.id) : false
      }));
      return NextResponse.json({ ok: true, viewerWallet, viewerRole, coins: out });
    }

    // --- TRENDING: compute recency-weighted score from recent votes/comments ---
    const now = Date.now();
    const sinceVotesMs = now - 48 * HOUR;   // lookback for votes
    const sinceCommentsMs = now - 12 * HOUR; // lookback for comments

    const ids = coinList.map((c) => c.id);

    // Pull recent votes (coin_id, created_at)
    const { data: recentVotes, error: votesErr } = await sb
      .from("coin_votes")
      .select("coin_id, created_at")
      .in("coin_id", ids)
      .gte("created_at", new Date(sinceVotesMs).toISOString())
      .limit(10000);

    if (votesErr) {
      // Still return a fallback ordering if vote query fails
      const fallback = coinList
        .map((c: any) => ({
          ...c,
          viewer_has_upvoted: viewerWallet ? votedSet.has(c.id) : false,
          trending_score: Number(c.upvotes_24h ?? 0),
          upvotes_1h: 0,
          upvotes_3h: 0,
          comments_12h: 0
        }))
        .sort((a: any, b: any) => (b.trending_score || 0) - (a.trending_score || 0));

      return NextResponse.json({ ok: true, viewerWallet, viewerRole, coins: fallback });
    }

    // Pull recent comments count per coin (12h)
    const { data: recentComments, error: commentsErr } = await sb
      .from("coin_comments")
      .select("coin_id, created_at")
      .in("coin_id", ids)
      .gte("created_at", new Date(sinceCommentsMs).toISOString())
      .limit(10000);

    // Build maps
    const voteDecay = new Map<string, number>();
    const votes1h = new Map<string, number>();
    const votes3h = new Map<string, number>();

    for (const v of recentVotes ?? []) {
      const coinId = String((v as any).coin_id);
      const ms = safeDateMs((v as any).created_at);
      if (!ms) continue;

      const ageHrs = (now - ms) / HOUR;
      if (ageHrs < 0 || ageHrs > 48) continue;

      const w = expDecayWeight(ageHrs, 6); // half-life 6h
      voteDecay.set(coinId, (voteDecay.get(coinId) ?? 0) + w);

      if (now - ms <= 1 * HOUR) votes1h.set(coinId, (votes1h.get(coinId) ?? 0) + 1);
      if (now - ms <= 3 * HOUR) votes3h.set(coinId, (votes3h.get(coinId) ?? 0) + 1);
    }

    const comments12h = new Map<string, number>();
    if (!commentsErr) {
      for (const c of recentComments ?? []) {
        const coinId = String((c as any).coin_id);
        comments12h.set(coinId, (comments12h.get(coinId) ?? 0) + 1);
      }
    }

    // Score formula:
    // decay_score + 0.75*votes_1h + 0.25*votes_3h + 0.15*comments_12h
    const out = coinList
      .map((c: any) => {
        const id = String(c.id);
        const decay = voteDecay.get(id) ?? 0;
        const v1 = votes1h.get(id) ?? 0;
        const v3 = votes3h.get(id) ?? 0;
        const cm12 = comments12h.get(id) ?? 0;

        const trending_score = decay + 0.75 * v1 + 0.25 * v3 + 0.15 * cm12;

        return {
          ...c,
          viewer_has_upvoted: viewerWallet ? votedSet.has(id) : false,
          trending_score,
          upvotes_1h: v1,
          upvotes_3h: v3,
          comments_12h: cm12
        };
      })
      .sort((a: any, b: any) => {
        // primary: trending score
        if ((b.trending_score ?? 0) !== (a.trending_score ?? 0)) {
          return (b.trending_score ?? 0) - (a.trending_score ?? 0);
        }
        // tie-breakers
        if ((b.upvotes_24h ?? 0) !== (a.upvotes_24h ?? 0)) return (b.upvotes_24h ?? 0) - (a.upvotes_24h ?? 0);
        if ((b.upvotes_count ?? 0) !== (a.upvotes_count ?? 0)) return (b.upvotes_count ?? 0) - (a.upvotes_count ?? 0);
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

    return NextResponse.json({ ok: true, viewerWallet, viewerRole, coins: out });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load coins", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
