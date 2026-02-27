import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Ctx = {
  params: {
    id: string;
  };
};

function pickBestDexPair(pairs: any[]) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;

  // Prefer Solana chain if available, then highest liquidity
  const solPairs = pairs.filter((p) => String(p.chainId).toLowerCase() === "solana");
  const list = solPairs.length ? solPairs : pairs;

  return list
    .slice()
    .sort((a, b) => {
      const la = Number(a?.liquidity?.usd ?? 0);
      const lb = Number(b?.liquidity?.usd ?? 0);
      return lb - la;
    })[0];
}

async function fetchJupiterToken(mint: string) {
  // Jupiter strict token list (fast + has logo/name/symbol when known)
  // No API key needed.
  const url = `https://token.jup.ag/strict`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const list = (await res.json().catch(() => null)) as any[] | null;
  if (!Array.isArray(list)) return null;

  const hit = list.find((t) => t?.address === mint);
  if (!hit) return null;

  return {
    address: hit.address,
    name: hit.name ?? null,
    symbol: hit.symbol ?? null,
    logoURI: hit.logoURI ?? null,
    decimals: typeof hit.decimals === "number" ? hit.decimals : null
  };
}

async function fetchDexScreener(mint: string) {
  // DexScreener token endpoint (no key needed)
  const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const json = await res.json().catch(() => null);
  const pair = pickBestDexPair(json?.pairs ?? []);
  if (!pair) return null;

  return {
    chainId: pair.chainId ?? null,
    dexId: pair.dexId ?? null,
    url: pair.url ?? null,

    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
    fdv: pair.fdv != null ? Number(pair.fdv) : null,
    marketCap: pair.marketCap != null ? Number(pair.marketCap) : null,

    liquidityUsd: pair?.liquidity?.usd != null ? Number(pair.liquidity.usd) : null,
    liquidityBase: pair?.liquidity?.base != null ? Number(pair.liquidity.base) : null,
    liquidityQuote: pair?.liquidity?.quote != null ? Number(pair.liquidity.quote) : null,

    volume24h: pair?.volume?.h24 != null ? Number(pair.volume.h24) : null,
    volume6h: pair?.volume?.h6 != null ? Number(pair.volume.h6) : null,
    volume1h: pair?.volume?.h1 != null ? Number(pair.volume.h1) : null,
    txns24h:
      pair?.txns?.h24
        ? {
            buys: Number(pair.txns.h24.buys ?? 0),
            sells: Number(pair.txns.h24.sells ?? 0)
          }
        : null,

    pairAddress: pair.pairAddress ?? null,
    baseToken: pair.baseToken
      ? { address: pair.baseToken.address ?? null, name: pair.baseToken.name ?? null, symbol: pair.baseToken.symbol ?? null }
      : null,
    quoteToken: pair.quoteToken
      ? { address: pair.quoteToken.address ?? null, name: pair.quoteToken.name ?? null, symbol: pair.quoteToken.symbol ?? null }
      : null,

    // DexScreener sometimes provides an "info.imageUrl" for token/pair branding
    imageUrl: pair?.info?.imageUrl ?? null
  };
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const id = ctx?.params?.id?.trim();
    if (!id) return NextResponse.json({ error: "Missing coin id" }, { status: 400 });

    const sb = supabaseAdmin();

    const { data: coin, error } = await sb
      .from("coins")
      .select("id,wallet,token_address,title,description,created_at")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!coin) return NextResponse.json({ error: "Coin not found" }, { status: 404 });

    const mint = String(coin.token_address);

    const [jup, dex] = await Promise.all([fetchJupiterToken(mint), fetchDexScreener(mint)]);

    return NextResponse.json({
      ok: true,
      coin: {
        id: coin.id,
        dev_wallet: coin.wallet,
        token_address: coin.token_address,
        title: coin.title ?? null,
        description: coin.description ?? null,
        created_at: coin.created_at
      },
      token: jup,
      market: dex
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load coin", details: e?.message || String(e) },
      { status: 500 }
    );
  }
}
