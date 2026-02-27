import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function toNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  try {
    const id = (ctx?.params?.id || "").trim();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    // viewer wallet (optional, but nice for gating + UI)
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const session = sessionToken ? await readSessionToken(sessionToken).catch(() => null) : null;
    const viewerWallet = session?.wallet ?? null;

    const sb = supabaseAdmin();

    // 1) coin from DB
    const { data: coinRow, error: coinErr } = await sb
      .from("coins")
      .select("id, wallet, token_address, title, description, created_at")
      .eq("id", id)
      .maybeSingle();

    if (coinErr) return NextResponse.json({ error: coinErr.message }, { status: 500 });
    if (!coinRow) return NextResponse.json({ error: "Coin not found" }, { status: 404 });

    // 2) counts + viewer vote
    const [{ count: upvotesCount }, { count: commentsCount }, viewerVote] = await Promise.all([
      sb.from("coin_votes").select("*", { count: "exact", head: true }).eq("coin_id", id),
      sb.from("coin_comments").select("*", { count: "exact", head: true }).eq("coin_id", id),
      viewerWallet
        ? sb.from("coin_votes").select("coin_id").eq("coin_id", id).eq("voter_wallet", viewerWallet).maybeSingle()
        : Promise.resolve({ data: null } as any)
    ]);

    // 3) Jupiter token info (name/symbol/logo) – public endpoint
    // If Jupiter returns nothing, we’ll keep it null.
    let token: any = null;
    try {
      const mint = coinRow.token_address;
      const jRes = await fetch(`https://token.jup.ag/strict?mint=${encodeURIComponent(mint)}`, {
        cache: "no-store"
      });

      // some environments might block; just fail soft
      if (jRes.ok) {
        const j = await jRes.json().catch(() => null);
        // j might be token object or array depending on endpoint behavior
        if (j && !Array.isArray(j)) token = j;
        if (Array.isArray(j) && j.length) token = j[0];
      }
    } catch {
      token = null;
    }

    // 4) DexScreener market data – public endpoint
    let market: any = null;
    try {
      const mint = coinRow.token_address;
      const dRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, {
        cache: "no-store"
      });
      if (dRes.ok) {
        const d = await dRes.json().catch(() => null);
        const pairs = Array.isArray(d?.pairs) ? d.pairs : [];
        const best = pairs[0] ?? null;

        if (best) {
          market = {
            chainId: best.chainId ?? null,
            dexId: best.dexId ?? null,
            url: best.url ?? null,

            priceUsd: toNum(best.priceUsd),
            fdv: toNum(best.fdv),
            marketCap: toNum(best.marketCap),

            liquidityUsd: toNum(best?.liquidity?.usd),
            liquidityBase: toNum(best?.liquidity?.base),
            liquidityQuote: toNum(best?.liquidity?.quote),

            volume24h: toNum(best?.volume?.h24),
            volume6h: toNum(best?.volume?.h6),
            volume1h: toNum(best?.volume?.h1),

            txns24h: best?.txns?.h24
              ? { buys: Number(best.txns.h24.buys ?? 0), sells: Number(best.txns.h24.sells ?? 0) }
              : null,

            pairAddress: best.pairAddress ?? null,
            baseToken: best.baseToken
              ? { address: best.baseToken.address ?? null, name: best.baseToken.name ?? null, symbol: best.baseToken.symbol ?? null }
              : null,
            quoteToken: best.quoteToken
              ? { address: best.quoteToken.address ?? null, name: best.quoteToken.name ?? null, symbol: best.quoteToken.symbol ?? null }
              : null,

            imageUrl: best?.info?.imageUrl ?? null
          };
        }
      }
    } catch {
      market = null;
    }

    const coin = {
      id: coinRow.id,
      dev_wallet: coinRow.wallet,
      token_address: coinRow.token_address,
      title: coinRow.title,
      description: coinRow.description,
      created_at: coinRow.created_at,

      upvotes_count: Number(upvotesCount ?? 0),
      comments_count: Number(commentsCount ?? 0),
      viewer_has_upvoted: Boolean(viewerVote?.data)
    };

    return NextResponse.json({
      ok: true,
      viewerWallet,
      coin,
      token: token
        ? {
            address: token.address ?? coinRow.token_address,
            name: token.name ?? null,
            symbol: token.symbol ?? null,
            logoURI: token.logoURI ?? null,
            decimals: token.decimals ?? null
          }
        : null,
      market
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
