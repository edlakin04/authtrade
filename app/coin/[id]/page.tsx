"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

type ApiCoin = {
  id: string;
  dev_wallet: string;
  token_address: string;
  title: string | null;
  description: string | null;
  created_at: string;
};

type ApiToken = {
  address: string;
  name: string | null;
  symbol: string | null;
  logoURI: string | null;
  decimals: number | null;
} | null;

type ApiMarket = {
  chainId: string | null;
  dexId: string | null;
  url: string | null;

  priceUsd: number | null;
  fdv: number | null;
  marketCap: number | null;

  liquidityUsd: number | null;
  liquidityBase: number | null;
  liquidityQuote: number | null;

  volume24h: number | null;
  volume6h: number | null;
  volume1h: number | null;
  txns24h: { buys: number; sells: number } | null;

  pairAddress: string | null;
  baseToken: { address: string | null; name: string | null; symbol: string | null } | null;
  quoteToken: { address: string | null; name: string | null; symbol: string | null } | null;

  imageUrl: string | null;
} | null;

type ApiResp = {
  ok: true;
  coin: ApiCoin;
  token: ApiToken;
  market: ApiMarket;
};

function shortAddr(s: string) {
  if (!s) return "";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

function fmtCompact(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    notation: "compact",
    maximumFractionDigits: 2
  });
}

export default function CoinPage({ params }: { params: { id: string } }) {
  const coinId = params.id;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [coin, setCoin] = useState<ApiCoin | null>(null);
  const [token, setToken] = useState<ApiToken>(null);
  const [market, setMarket] = useState<ApiMarket>(null);

  const mint = useMemo(() => coin?.token_address ?? "", [coin?.token_address]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/coin/${encodeURIComponent(coinId)}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ApiResp | { error?: string } | null;

      if (!res.ok) throw new Error((json as any)?.error || "Failed to load coin");

      const data = json as ApiResp;
      setCoin(data.coin);
      setToken(data.token ?? null);
      setMarket(data.market ?? null);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load coin");
      setCoin(null);
      setToken(null);
      setMarket(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinId]);

  // pick best image: Jupiter logo first, then DexScreener image
  const image = token?.logoURI || market?.imageUrl || null;

  // name/symbol: Jupiter first, fallback to DexScreener base token
  const displayName =
    token?.name ||
    market?.baseToken?.name ||
    coin?.title ||
    "Coin";

  const displaySymbol =
    token?.symbol ||
    market?.baseToken?.symbol ||
    null;

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link href="/coins" className="text-sm text-zinc-400 hover:text-white">
          ← Back to coins
        </Link>

        {loading ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : err ? (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-200">
            {err}
          </div>
        ) : !coin ? null : (
          <>
            {/* HEADER CARD */}
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : null}
                  </div>

                  <div className="min-w-0">
                    <h1 className="text-2xl font-semibold">
                      {displayName}
                      {displaySymbol ? <span className="ml-2 text-zinc-400">({displaySymbol})</span> : null}
                    </h1>

                    <div className="mt-1 break-all font-mono text-xs text-zinc-400">
                      {coin.token_address}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                      <span>
                        Dev:{" "}
                        <Link
                          href={`/dev/${encodeURIComponent(coin.dev_wallet)}`}
                          className="text-zinc-200 hover:text-white"
                        >
                          {shortAddr(coin.dev_wallet)}
                        </Link>
                      </span>
                      <span>•</span>
                      <span>{new Date(coin.created_at).toLocaleString()}</span>

                      {market?.dexId ? (
                        <>
                          <span>•</span>
                          <span className="uppercase">{market.dexId}</span>
                        </>
                      ) : null}

                      {market?.chainId ? (
                        <>
                          <span>•</span>
                          <span className="uppercase">{market.chainId}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  <Link
                    href={`/trade?outputMint=${encodeURIComponent(mint)}`}
                    className="rounded-xl bg-white px-4 py-2 text-center text-sm font-semibold text-black hover:bg-zinc-200"
                  >
                    Trade
                  </Link>

                  {market?.url ? (
                    <a
                      href={market.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center text-sm hover:bg-white/10"
                    >
                      View on DexScreener ↗
                    </a>
                  ) : (
                    <button
                      disabled
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center text-sm opacity-60"
                    >
                      DexScreener unavailable
                    </button>
                  )}
                </div>
              </div>

              {coin.description ? (
                <p className="mt-4 text-sm text-zinc-300">{coin.description}</p>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">No description.</p>
              )}
            </div>

            {/* METRICS */}
            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">Price</p>
                <p className="mt-2 text-lg font-semibold">{fmtUsd(market?.priceUsd ?? null)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">Liquidity</p>
                <p className="mt-2 text-lg font-semibold">{fmtUsd(market?.liquidityUsd ?? null)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">Market cap</p>
                <p className="mt-2 text-lg font-semibold">
                  {market?.marketCap != null ? fmtUsd(market.marketCap) : fmtUsd(market?.fdv ?? null)}
                </p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {market?.marketCap != null ? "Market cap" : "FDV (fallback)"}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">Volume 24h</p>
                <p className="mt-2 text-lg font-semibold">{fmtUsd(market?.volume24h ?? null)}</p>
              </div>
            </div>

            {/* EXTRA DETAILS */}
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Market details</h2>

              {!market ? (
                <p className="mt-2 text-sm text-zinc-500">
                  No DexScreener market data found for this token yet.
                </p>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="text-xs text-zinc-400">Buys / sells (24h)</div>
                    <div className="mt-2 text-sm text-zinc-200">
                      {market.txns24h ? `${market.txns24h.buys} / ${market.txns24h.sells}` : "—"}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="text-xs text-zinc-400">Volume (6h / 1h)</div>
                    <div className="mt-2 text-sm text-zinc-200">
                      {market.volume6h != null || market.volume1h != null
                        ? `${fmtCompact(market.volume6h)} / ${fmtCompact(market.volume1h)}`
                        : "—"}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="text-xs text-zinc-400">Pair</div>
                    <div className="mt-2 break-all font-mono text-[11px] text-zinc-300">
                      {market.pairAddress ?? "—"}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* COMMUNITY placeholder */}
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Community</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Next chunk: we’ll bring coin upvotes + comments onto this page (same APIs you already built).
              </p>

              <div className="mt-4">
                <Link
                  href="/coins"
                  className="inline-block rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  Open coins list →
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
