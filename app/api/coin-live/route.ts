import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickBestSolanaPair(pairs: any[]): any | null {
  const solPairs = (pairs || []).filter((p) => p?.chainId === "solana");
  if (solPairs.length === 0) return null;

  // Prefer highest liquidity USD
  solPairs.sort((a, b) => (Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0)));
  return solPairs[0] ?? null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mint = (url.searchParams.get("mint") || "").trim();

    if (!mint) {
      return NextResponse.json({ error: "Missing mint" }, { status: 400 });
    }

    // --- Jupiter token metadata (name/symbol/logo) ---
    // Public, no key needed.
    let meta: { name?: string; symbol?: string; logoURI?: string } | null = null;

    try {
      const jupRes = await fetch("https://token.jup.ag/all", {
        cache: "no-store",
        // keep it resilient
        headers: { "accept": "application/json" }
      });

      if (jupRes.ok) {
        const tokens = (await jupRes.json().catch(() => null)) as any[] | null;
        const found = (tokens || []).find((t) => String(t?.address) === mint);
        if (found) meta = { name: found.name, symbol: found.symbol, logoURI: found.logoURI };
      }
    } catch {
      // ignore; we'll still return DexScreener data
    }

    // --- DexScreener market data ---
    // Public, no key needed.
    const dsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, {
      cache: "no-store",
      headers: { "accept": "application/json" }
    });

    if (!dsRes.ok) {
      const txt = await dsRes.text().catch(() => "");
      return NextResponse.json(
        { error: "DexScreener failed", details: `status ${dsRes.status}: ${txt}` },
        { status: 502 }
      );
    }

    const dsJson = await dsRes.json().catch(() => null);
    const pairs = (dsJson?.pairs || []) as any[];
    const best = pickBestSolanaPair(pairs);

    // If no Solana pair yet, still return metadata so the page has something
    if (!best) {
      return NextResponse.json({
        ok: true,
        mint,
        name: meta?.name ?? null,
        symbol: meta?.symbol ?? null,
        image: meta?.logoURI ?? null,
        priceUsd: null,
        liquidityUsd: null,
        marketCapUsd: null,
        volume24hUsd: null,
        pairUrl: null,
        source: "dexscreener",
        note: "No Solana pair found for this mint yet."
      });
    }

    const priceUsd = num(best?.priceUsd);
    const liquidityUsd = num(best?.liquidity?.usd);
    const volume24hUsd = num(best?.volume?.h24);

    // DexScreener commonly provides fdv; sometimes marketCap.
    // We'll prefer marketCap if present, otherwise fdv.
    const marketCapUsd = num(best?.marketCap) ?? num(best?.fdv);

    const base = best?.baseToken || {};
    const quote = best?.quoteToken || {};

    return NextResponse.json({
      ok: true,
      mint,
      name: meta?.name ?? base?.name ?? null,
      symbol: meta?.symbol ?? base?.symbol ?? null,
      image: meta?.logoURI ?? null,

      priceUsd,
      liquidityUsd,
      marketCapUsd,
      volume24hUsd,

      pairUrl: best?.url ?? null,
      dexId: best?.dexId ?? null,
      quoteSymbol: quote?.symbol ?? null,

      updatedAt: new Date().toISOString()
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load live coin data", details: e?.message || String(e) },
      { status: 500 }
    );
  }
}
