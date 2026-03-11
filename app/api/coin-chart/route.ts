import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Candle = {
  time: number;       // unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ChartPayload = {
  ok: true;
  mint: string;
  pairAddress: string | null;
  dexId: string | null;
  baseSymbol: string | null;
  quoteSymbol: string | null;
  resolution: string;  // e.g. "5m", "1h", "1d"
  candles: Candle[];
  priceChange: {
    m5: number | null;
    h1: number | null;
    h6: number | null;
    h24: number | null;
  };
  updatedAt: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickBestSolanaPair(pairs: any[]): any | null {
  const sol = (pairs || []).filter((p) => p?.chainId === "solana");
  if (!sol.length) return null;
  sol.sort((a, b) => Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0));
  return sol[0];
}

// Map resolution param → GeckoTerminal timeframe + aggregate
function resolveTimeframe(res: string): {
  gtTimeframe: "minute" | "hour" | "day";
  gtAggregate: number;
  limit: number;
} {
  switch (res) {
    case "5m":  return { gtTimeframe: "minute", gtAggregate: 5,  limit: 120 }; // 10h of 5m
    case "15m": return { gtTimeframe: "minute", gtAggregate: 15, limit: 96  }; // 24h of 15m
    case "1h":  return { gtTimeframe: "hour",   gtAggregate: 1,  limit: 168 }; // 7d of 1h
    case "4h":  return { gtTimeframe: "hour",   gtAggregate: 4,  limit: 90  }; // 15d of 4h
    case "1d":  return { gtTimeframe: "day",    gtAggregate: 1,  limit: 90  }; // 90d
    default:    return { gtTimeframe: "minute", gtAggregate: 5,  limit: 120 };
  }
}

// ─── GET /api/coin-chart?mint=...&resolution=5m ───────────────────────────────

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mint = (url.searchParams.get("mint") ?? "").trim();
    const resolution = (url.searchParams.get("resolution") ?? "5m").trim();

    if (!mint) {
      return NextResponse.json({ error: "Missing mint" }, { status: 400 });
    }

    // ── 1. Get pair address from DexScreener ──────────────────────────────────
    const dsUrl = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`;
    const dsRes = await fetch(dsUrl, {
      cache: "no-store",
      headers: { accept: "application/json" }
    });

    if (!dsRes.ok) {
      return NextResponse.json(
        { error: "DexScreener unavailable", details: `status ${dsRes.status}` },
        { status: 502 }
      );
    }

    const dsJson = await dsRes.json().catch(() => null);
    const pairs = (dsJson?.pairs ?? []) as any[];
    const best = pickBestSolanaPair(pairs);

    if (!best) {
      return NextResponse.json({
        ok: true,
        mint,
        pairAddress: null,
        dexId: null,
        baseSymbol: null,
        quoteSymbol: null,
        resolution,
        candles: [],
        priceChange: { m5: null, h1: null, h6: null, h24: null },
        updatedAt: new Date().toISOString(),
        note: "No Solana trading pair found yet."
      });
    }

    const pairAddress: string = best.pairAddress ?? best.id ?? null;
    const dexId: string | null = best.dexId ?? null;
    const baseSymbol: string | null = best.baseToken?.symbol ?? null;
    const quoteSymbol: string | null = best.quoteToken?.symbol ?? null;

    const priceChange = {
      m5:  num(best.priceChange?.m5)  ?? null,
      h1:  num(best.priceChange?.h1)  ?? null,
      h6:  num(best.priceChange?.h6)  ?? null,
      h24: num(best.priceChange?.h24) ?? null,
    };

    if (!pairAddress) {
      return NextResponse.json({
        ok: true,
        mint,
        pairAddress: null,
        dexId,
        baseSymbol,
        quoteSymbol,
        resolution,
        candles: [],
        priceChange,
        updatedAt: new Date().toISOString(),
        note: "Pair found but no address available."
      });
    }

    // ── 2. Fetch OHLCV candles from GeckoTerminal ─────────────────────────────
    // GeckoTerminal uses the pool/pair address directly for Solana
    const { gtTimeframe, gtAggregate, limit } = resolveTimeframe(resolution);

    const gtUrl =
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${encodeURIComponent(pairAddress)}/ohlcv/${gtTimeframe}` +
      `?aggregate=${gtAggregate}&limit=${limit}&currency=usd&token=base`;

    const gtRes = await fetch(gtUrl, {
      cache: "no-store",
      headers: { accept: "application/json" }
    });

    // GeckoTerminal might 404 for very new pools — that's fine, return empty candles
    if (!gtRes.ok) {
      return NextResponse.json({
        ok: true,
        mint,
        pairAddress,
        dexId,
        baseSymbol,
        quoteSymbol,
        resolution,
        candles: [],
        priceChange,
        updatedAt: new Date().toISOString(),
        note: `No candle data yet (GeckoTerminal ${gtRes.status}).`
      } satisfies ChartPayload);
    }

    const gtJson = await gtRes.json().catch(() => null);

    // GeckoTerminal OHLCV response shape:
    // { data: { attributes: { ohlcv_list: [[timestamp_ms, open, high, low, close, volume], ...] } } }
    const rawList: any[] =
      gtJson?.data?.attributes?.ohlcv_list ?? [];

    const candles: Candle[] = rawList
      .map((row: any) => {
        // row = [timestamp_ms, open, high, low, close, volume]
        const time   = Math.floor(Number(row[0]) / 1000); // convert ms → seconds
        const open   = Number(row[1]);
        const high   = Number(row[2]);
        const low    = Number(row[3]);
        const close  = Number(row[4]);
        const volume = Number(row[5]);
        if (!Number.isFinite(time) || !Number.isFinite(open)) return null;
        return { time, open, high, low, close, volume };
      })
      .filter((c): c is Candle => c !== null)
      // GeckoTerminal returns newest-first — reverse to ascending for charting libs
      .reverse();

    return NextResponse.json({
      ok: true,
      mint,
      pairAddress,
      dexId,
      baseSymbol,
      quoteSymbol,
      resolution,
      candles,
      priceChange,
      updatedAt: new Date().toISOString()
    } satisfies ChartPayload);

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load chart data", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
