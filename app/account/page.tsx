"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import TopNav from "@/components/TopNav";

type Portfolio = {
  ok: true;
  owner: string;
  sol: number;
  solUsd: number | null;
  solUsdValue: number | null;
  totalUsd: number | null;
  tokens: Array<{
    mint: string;
    uiAmount: number;
    decimals: number;
    usdPrice: number | null;
    usdValue: number | null;
  }>;
};

const WSOL_MINT = "So11111111111111111111111111111111111111112";

function shortMint(m: string) {
  if (!m) return "";
  return `${m.slice(0, 4)}…${m.slice(-4)}`;
}

function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export default function AccountPage() {
  const { publicKey, connected } = useWallet();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Portfolio | null>(null);

  const owner = useMemo(() => publicKey?.toBase58() ?? "", [publicKey]);

  useEffect(() => {
    if (!connected || !owner) {
      setData(null);
      setErr(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/portfolio?owner=${encodeURIComponent(owner)}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);

        if (!res.ok) throw new Error(json?.details || json?.error || "Failed to load portfolio");
        if (!cancelled) setData(json as Portfolio);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load portfolio");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, owner]);

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Account</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Portfolio for {owner ? shortMint(owner) : "—"}
            </p>
          </div>

          <Link
            href="/subscription"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            Subscription
          </Link>
        </div>

        {!connected && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-zinc-300">Connect a wallet to view your portfolio.</p>
          </div>
        )}

        {connected && (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">Total balance</p>
                <p className="mt-2 text-2xl font-semibold">{fmtUsd(data?.totalUsd ?? null)}</p>
                <p className="mt-1 text-xs text-zinc-500">Est. USD value via Jupiter price feed</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">SOL</p>
                <p className="mt-2 text-xl font-semibold">
                  {data ? data.sol.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"}
                </p>
                <p className="mt-1 text-sm text-zinc-300">{fmtUsd(data?.solUsdValue ?? null)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">Quick actions</p>
                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/trade?outputMint=${encodeURIComponent(WSOL_MINT)}`}
                    className="w-full rounded-xl bg-white px-4 py-2 text-center text-sm font-semibold text-black hover:bg-zinc-200"
                  >
                    Swap
                  </Link>
                  <Link
                    href="/coins"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center text-sm hover:bg-white/10"
                  >
                    Browse coins
                  </Link>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Tokens</h2>
                {loading && <span className="text-xs text-zinc-400">Loading…</span>}
              </div>

              {err && <p className="mt-3 text-sm text-red-300">{err}</p>}

              {!loading && data && data.tokens.length === 0 && (
                <p className="mt-3 text-sm text-zinc-300">No SPL tokens found.</p>
              )}

              <div className="mt-4 divide-y divide-white/10">
                {data?.tokens?.map((t) => (
                  <div key={t.mint} className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div className="min-w-[240px]">
                      <p className="text-sm font-medium">{shortMint(t.mint)}</p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {t.uiAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} •{" "}
                        {t.usdPrice ? `$${t.usdPrice.toFixed(6)}` : "No price"}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm">{fmtUsd(t.usdValue ?? null)}</p>
                      <div className="mt-2 flex justify-end gap-2">
                        <Link
                          href={`/trade?outputMint=${encodeURIComponent(t.mint)}`}
                          className="rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-zinc-200"
                        >
                          Buy
                        </Link>
                        <Link
                          href={`/trade?inputMint=${encodeURIComponent(t.mint)}&outputMint=${encodeURIComponent(
                            WSOL_MINT
                          )}`}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                        >
                          Sell
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-xs text-zinc-500">
                Prices are fetched via Jupiter Price API V3 and may be unavailable for some tokens. :contentReference[oaicite:2]{index=2}
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
