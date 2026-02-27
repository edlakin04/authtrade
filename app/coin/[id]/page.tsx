"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

function shortAddr(s: string) {
  if (!s) return "";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type CoinDetails = {
  ok: true;
  viewerWallet: string | null;
  coin: {
    id: string;
    wallet: string; // dev wallet
    token_address: string;
    title: string | null;
    description: string | null;
    created_at: string;
  };
  // placeholders for later:
  market?: {
    name?: string;
    symbol?: string;
    image?: string;
    priceUsd?: number;
    mcapUsd?: number;
    liquidityUsd?: number;
    volume24hUsd?: number;
    holders?: number;
  } | null;
};

export default function CoinPage({ params }: { params: { id: string } }) {
  const coinId = params.id;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<CoinDetails | null>(null);

  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      // For now, we call an API we’ll create in the next chunk.
      // If you don’t have it yet, this page will show a friendly error.
      const res = await fetch(`/api/coin/${encodeURIComponent(coinId)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);

      if (!res.ok) throw new Error(json?.error || "Failed to load coin");
      setData(json as CoinDetails);
    } catch (e: any) {
      setErr(e?.message || "Failed to load coin");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinId]);

  const tokenAddr = data?.coin.token_address ?? "";
  const devWallet = data?.coin.wallet ?? "";

  const displayName =
    data?.market?.name ||
    data?.coin.title ||
    (tokenAddr ? `Token ${shortAddr(tokenAddr)}` : "Coin");

  const symbol = data?.market?.symbol ? `$${data.market.symbol}` : null;

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link href="/coins" className="text-sm text-zinc-400 hover:text-white">
              ← Back to Coins
            </Link>
            <h1 className="mt-3 text-2xl font-semibold">Coin</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Detailed view for a single coin (market stats coming next).
            </p>
          </div>

          {tokenAddr ? (
            <Link
              href={`/trade?outputMint=${encodeURIComponent(tokenAddr)}`}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
            >
              Trade
            </Link>
          ) : null}
        </div>

        {err ? (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-200">
            {err}
            <div className="mt-2 text-xs text-red-200/80">
              (If this is your first time opening coin pages: next chunk adds the{" "}
              <span className="font-mono">/api/coin/[id]</span> route.)
            </div>
          </div>
        ) : loading ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : !data ? (
          <div className="mt-6 text-zinc-400">Not found.</div>
        ) : (
          <>
            {/* Header card */}
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {data.market?.image ? (
                      <img src={data.market.image} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                        IMG
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xl font-semibold">{displayName}</div>
                      {symbol ? (
                        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">
                          {symbol}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 font-mono">
                        {shortAddr(tokenAddr)}
                      </span>

                      <button
                        onClick={() => {
                          if (!tokenAddr) return;
                          const ok = copyToClipboard(tokenAddr);
                          setCopied(ok);
                          setTimeout(() => setCopied(false), 1200);
                        }}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs hover:bg-white/10"
                      >
                        {copied ? "Copied" : "Copy address"}
                      </button>

                      <span>•</span>
                      <span>{new Date(data.coin.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="text-xs text-zinc-400">Posted by</div>
                  <Link
                    href={`/dev/${encodeURIComponent(devWallet)}`}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                  >
                    {shortAddr(devWallet)} →
                  </Link>
                </div>
              </div>

              <div className="mt-5">
                {data.coin.description ? (
                  <p className="text-sm text-zinc-300">{data.coin.description}</p>
                ) : (
                  <p className="text-sm text-zinc-500">No description.</p>
                )}
              </div>
            </div>

            {/* Stats grid (placeholders for now) */}
            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <StatCard label="Price" value="—" hint="Next chunk" />
              <StatCard label="Market cap" value="—" hint="Next chunk" />
              <StatCard label="Liquidity" value="—" hint="Next chunk" />
              <StatCard label="24h volume" value="—" hint="Next chunk" />
            </div>

            {/* Social / actions placeholders */}
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-lg font-semibold">Discussion</h2>
                <p className="mt-2 text-sm text-zinc-400">
                  Next chunk: show comments here (same system you already built).
                </p>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-lg font-semibold">Upvotes</h2>
                <p className="mt-2 text-sm text-zinc-400">
                  Next chunk: show upvote count + button here.
                </p>
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}
