"use client";

import React, { useEffect, useMemo, useState } from "react";
import TopNav from "@/components/TopNav";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type Holding = {
  mint: string;
  uiAmount: number;
  decimals: number;
  usdPrice: number | null;
  usdValue: number | null;
  coin: {
    id: string;
    wallet: string;
    token_address: string;
    title: string | null;
    description: string | null;
    created_at: string;
  };
  dev: {
    wallet: string;
    display_name: string | null;
    pfp_url: string | null;
  };
};

type WalletPayload = {
  ok: true;
  owner: string;
  sol: number;
  solUsdPrice: number | null;
  solUsdValue: number | null;
  totalUsd: number | null;
  holdings: Holding[];
};

type LiveMeta = {
  ok: true;
  mint: string;
  name: string | null;
  symbol: string | null;
  image: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortWallet(w: string) {
  if (!w || w.length < 8) return w;
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return "$0.00";
}

function fmtAmount(n: number) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UserWalletPage({
  params
}: {
  params: Promise<{ wallet: string }>;
}) {
  const [wallet, setWallet] = useState("");
  const [data, setData] = useState<WalletPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Live metadata (name, symbol, logo) from on-chain / DEX for each coin
  const [metaByMint, setMetaByMint] = useState<Record<string, LiveMeta | null>>({});
  const [metaLoading, setMetaLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const p = await params;
      setWallet(p.wallet);
    })();
  }, [params]);

  useEffect(() => {
    if (!wallet) return;

    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(
          `/api/public/wallet/${encodeURIComponent(wallet)}`,
          { cache: "no-store" }
        );
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setErr(json?.error ?? "Failed to load wallet");
          return;
        }
        setData(json as WalletPayload);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load wallet");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [wallet]);

  // Fetch live on-chain metadata for each coin (name, symbol, logo)
  async function fetchMeta(mint: string) {
    if (!mint || Object.prototype.hasOwnProperty.call(metaByMint, mint)) return;
    setMetaLoading((prev) => ({ ...prev, [mint]: true }));
    try {
      const res = await fetch(
        `/api/coin-live?mint=${encodeURIComponent(mint)}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => null);
      setMetaByMint((prev) => ({ ...prev, [mint]: res.ok ? json : null }));
    } finally {
      setMetaLoading((prev) => ({ ...prev, [mint]: false }));
    }
  }

  useEffect(() => {
    if (!data?.holdings?.length) return;
    const mints = data.holdings.map((h) => h.mint);
    // Batch in groups of 6 to avoid hammering
    (async () => {
      for (let i = 0; i < mints.length; i += 6) {
        await Promise.allSettled(mints.slice(i, i + 6).map(fetchMeta));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.holdings]);

  const shortAddr = useMemo(() => shortWallet(wallet), [wallet]);
  const holdings = data?.holdings ?? [];
  const totalUsd = data?.totalUsd ?? null;
  const sol = data?.sol ?? null;
  const solUsdValue = data?.solUsdValue ?? null;
  const solUsdPrice = data?.solUsdPrice ?? null;

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="mb-2">
          <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-300 transition">
            ← Dashboard
          </Link>
        </div>

        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Wallet</h1>
            <p className="mt-1 font-mono text-xs text-zinc-500 break-all">{wallet || "…"}</p>
          </div>

          {totalUsd !== null && (
            <div className="shrink-0 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-right">
              <div className="text-xs text-zinc-500 mb-0.5">Authswap holdings</div>
              <div className="text-2xl font-semibold text-white">{fmt(totalUsd)}</div>
            </div>
          )}
        </div>

        {/* ── States ─────────────────────────────────────────────────── */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-white/5 bg-white/[0.03] h-24"
              />
            ))}
          </div>
        )}

        {!loading && err && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-sm text-red-300">
            {err}
          </div>
        )}

        {!loading && !err && holdings.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
            <div className="text-3xl mb-3">⎔</div>
            <div className="text-sm font-medium text-zinc-300">No Authswap coins held</div>
            <div className="mt-1 text-xs text-zinc-500">
              This wallet doesn't hold any coins launched on Authswap.
            </div>
            <Link
              href="/coins"
              className="mt-4 inline-block rounded-xl bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-zinc-200 transition"
            >
              Browse coins →
            </Link>
          </div>
        )}

        {/* ── Holdings list ───────────────────────────────────────────── */}
        {/* ── SOL balance row ────────────────────────────────────────────── */}
        {!loading && !err && sol !== null && sol > 0 && (
          <div className="mb-1 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            {/* SOL logo */}
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30 flex items-center justify-center">
              <img
                src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
                alt="SOL"
                className="h-8 w-8 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">Solana</span>
                <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[11px] text-zinc-400">
                  SOL
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-500">
                  Native
                </span>
              </div>
              {solUsdPrice !== null && (
                <div className="mt-0.5 text-[11px] text-zinc-600">
                  @ {fmt(solUsdPrice)} per SOL
                </div>
              )}
            </div>

            <div className="shrink-0 text-right">
              {solUsdValue !== null ? (
                <>
                  <div className="text-base font-semibold text-white">{fmt(solUsdValue)}</div>
                  <div className="text-xs text-zinc-500">{sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL</div>
                </>
              ) : (
                <div className="text-base font-semibold text-zinc-300">
                  {sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && !err && holdings.length > 0 && (
          <div className="space-y-3">
            {holdings.map((h) => {
              const meta = metaByMint[h.mint];
              const isMetaLoading = !!metaLoading[h.mint];
              const logo = meta?.image ?? null;
              const name = meta?.name || h.coin.title || shortWallet(h.mint);
              const symbol = meta?.symbol ?? null;

              return (
                <Link
                  key={h.mint}
                  href={`/coin/${encodeURIComponent(h.coin.id)}`}
                  className="group block rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-white/20 hover:bg-white/[0.08]"
                >
                  <div className="flex items-center gap-4">
                    {/* Logo */}
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                      {logo ? (
                        <img src={logo} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-lg text-zinc-600">
                          {isMetaLoading ? (
                            <span className="text-xs text-zinc-600">…</span>
                          ) : (
                            "⎔"
                          )}
                        </div>
                      )}
                    </div>

                    {/* Coin info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">{name}</span>
                        {symbol && (
                          <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[11px] text-zinc-400">
                            {symbol}
                          </span>
                        )}
                      </div>

                      {/* Dev who launched it */}
                      <div className="mt-1 flex items-center gap-1.5">
                        {h.dev.pfp_url ? (
                          <img
                            src={h.dev.pfp_url}
                            alt=""
                            className="h-4 w-4 rounded-full border border-white/10 object-cover"
                          />
                        ) : (
                          <div className="h-4 w-4 rounded-full border border-white/10 bg-white/5" />
                        )}
                        <span className="text-[11px] text-zinc-500">
                          by{" "}
                          <span
                            className="text-zinc-400 hover:text-white"
                            onClick={(e) => {
                              e.preventDefault();
                              window.location.href = `/dev/${encodeURIComponent(h.dev.wallet)}`;
                            }}
                          >
                            {h.dev.display_name || shortWallet(h.dev.wallet)}
                          </span>
                        </span>
                      </div>

                      <div className="mt-1 font-mono text-[11px] text-zinc-600 truncate">
                        {h.mint}
                      </div>
                    </div>

                    {/* Amounts */}
                    <div className="shrink-0 text-right">
                      {h.usdValue !== null ? (
                        <>
                          <div className="text-base font-semibold text-white">
                            {fmt(h.usdValue)}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {fmtAmount(h.uiAmount)} {symbol ?? "tokens"}
                          </div>
                          {h.usdPrice !== null && (
                            <div className="text-[11px] text-zinc-600">
                              @ {fmt(h.usdPrice)} ea
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="text-base font-semibold text-zinc-300">
                            {fmtAmount(h.uiAmount)}
                          </div>
                          <div className="text-[11px] text-zinc-600">
                            {symbol ?? "tokens"} • no price
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* ── Footer note ─────────────────────────────────────────────── */}
        {!loading && holdings.length > 0 && (
          <p className="mt-6 text-center text-[11px] text-zinc-600">
            Showing {holdings.length} Authswap coin{holdings.length === 1 ? "" : "s"} held by{" "}
            <span className="font-mono">{shortAddr}</span>. Prices are live estimates.
          </p>
        )}
      </div>
    </main>
  );
}
