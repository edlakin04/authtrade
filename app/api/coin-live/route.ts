import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeImageUrl(u: string | null | undefined): string | null {
  const s = (u || "").trim();
  if (!s) return null;

  // ipfs://CID/... -> https://ipfs.io/ipfs/CID/...
  if (s.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${s.replace("ipfs://", "")}`;
  }

  // try to avoid http mixed-content
  if (s.startsWith("http://")) return s.replace("http://", "https://");

  return s;
}

function pickBestSolanaPair(pairs: any[]): any | null {
  const solPairs = (pairs || []).filter((p) => p?.chainId === "solana");
  if (solPairs.length === 0) return null;

  // Prefer highest liquidity USD
  solPairs.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
  return solPairs[0] ?? null;
}

async function getJupiterMeta(mint: string): Promise<{ name?: string; symbol?: string; logoURI?: string } | null> {
  // Jupiter token list endpoints (public). :contentReference[oaicite:1]{index=1}
  const endpoints = [
    "https://token.jup.ag/strict", // smaller
    "https://token.jup.ag/all" // fallback
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      if (!res.ok) continue;

      const tokens = (await res.json().catch(() => null)) as any[] | null;
      const found = (tokens || []).find((t) => String(t?.address) === mint);
      if (found) {
        return {
          name: found?.name,
          symbol: found?.symbol,
          logoURI: found?.logoURI
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mint = (url.searchParams.get("mint") || "").trim();

    if (!mint) return NextResponse.json({ error: "Missing mint" }, { status: 400 });

    // --- Jupiter token metadata (name/symbol/logo) ---
    const meta = await getJupiterMeta(mint);
    const metaImage = normalizeImageUrl(meta?.logoURI);

    // --- DexScreener market data ---
    const dsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, {
      cache: "no-store",
      headers: { accept: "application/json" }
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

    // Try to get an image from DexScreener response if available
    const dsImage =
      normalizeImageUrl(best?.info?.imageUrl) ||
      normalizeImageUrl(best?.baseToken?.logoURI) ||
      null;

    const image = metaImage || dsImage;

    // If no Solana pair yet, still return metadata so page has something
    if (!best) {
      return NextResponse.json({
        ok: true,
        mint,
        name: meta?.name ?? null,
        symbol: meta?.symbol ?? null,
        image,
        priceUsd: null,
        liquidityUsd: null,
        marketCapUsd: null,
        volume24hUsd: null,
        pairUrl: null,
        dexId: null,
        quoteSymbol: null,
        updatedAt: new Date().toISOString(),
        note: "No Solana pair found for this mint yet."
      });
    }

    const priceUsd = num(best?.priceUsd);
    const liquidityUsd = num(best?.liquidity?.usd);
    const volume24hUsd = num(best?.volume?.h24);
    const marketCapUsd = num(best?.marketCap) ?? num(best?.fdv);

    const base = best?.baseToken || {};
    const quote = best?.quoteToken || {};

    return NextResponse.json({
      ok: true,
      mint,
      name: meta?.name ?? base?.name ?? null,
      symbol: meta?.symbol ?? base?.symbol ?? null,
      image,

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
