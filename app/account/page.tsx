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

function shortAddr(m: string) {
  if (!m) return "";
  return `${m.slice(0, 4)}…${m.slice(-4)}`;
}

function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

function fmtAmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
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
        const res = await fetch(`/api/portfolio?owner=${encodeURIComponent(owner)}`, {
          cache: "no-store"
        });

        const text = await res.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(`Portfolio API returned non-JSON: ${text.slice(0, 120)}...`);
        }

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

  // Build a “Phantom-ish” list where SOL is the first row
  const rows = useMemo(() => {
    if (!data) return [];

    const solRow = {
      key: "SOL",
      name: "SOL",
      mint: WSOL_MINT,
      amount: data.sol,
      usdValue: data.solUsdValue,
      usdPrice: data.solUsd
    };

    const tokenRows = (data.tokens || []).map((t) => ({
      key: t.mint,
      name: shortAddr(t.mint), // we don’t have metadata yet
      mint: t.mint,
      amount: t.uiAmount,
      usdValue: t.usdValue,
      usdPrice: t.usdPrice
    }));

    return [solRow, ...tokenRows];
  }, [data]);

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-lg px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Account</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {owner ? `Wallet ${shortAddr(owner)}` : "Wallet —"}
            </p>
          </div>

          {loading && <span className="text-xs text-zinc-400">Loading…</span>}
        </div>

        {!connected && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-zinc-300">Connect a wallet to view your portfolio.</p>
          </div>
        )}

        {connected && (
          <>
            {/* Portrait “Total Balance” card */}
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl">
              <p className="text-xs text-zinc-400">Total balance</p>

              <div className="mt-2 flex items-end justify-between gap-3">
                <p className="text-3xl font-semibold tracking-tight">
                  {fmtUsd(data?.totalUsd ?? null)}
                </p>
                <div className="text-right">
                  <p className="text-xs text-zinc-500">SOL</p>
                  <p className="text-sm text-zinc-300">{data ? fmtAmt(data.sol) : "—"}</p>
                </div>
              </div>

              <p className="mt-2 text-xs text-zinc-500">
                USD is estimated from live prices. Some tokens won’t have a price.
              </p>

              {/* Quick actions (keep this) */}
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Link
                  href={`/trade?outputMint=${encodeURIComponent(WSOL_MINT)}`}
                  className="rounded-2xl bg-white px-4 py-3 text-center text-sm font-semibold text-black hover:bg-zinc-200"
                >
                  Swap
                </Link>
                <Link
                  href="/coins"
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-center text-sm hover:bg-white/10"
                >
                  Browse coins
                </Link>
              </div>
            </div>

            {/* Errors */}
            {err && (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-200">{err}</p>
              </div>
            )}

            {/* Token list (Phantom style) */}
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Tokens</h2>
                <span className="text-xs text-zinc-400">{rows.length ? `${rows.length}` : ""}</span>
              </div>

              <div className="mt-4 divide-y divide-white/10">
                {rows.map((r) => (
                  <div key={r.key} className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {fmtAmt(r.amount)}{" "}
                        {r.usdPrice ? `• $${r.usdPrice.toFixed(6)}` : ""}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm">{fmtUsd(r.usdValue ?? null)}</p>

                      {/* No “SOL” label rows; just show buttons for non-SOL tokens */}
                      {r.mint !== WSOL_MINT && (
                        <div className="mt-2 flex justify-end gap-2">
                          <Link
                            href={`/trade?outputMint=${encodeURIComponent(r.mint)}`}
                            className="rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-zinc-200"
                          >
                            Buy
                          </Link>
                          <Link
                            href={`/trade?inputMint=${encodeURIComponent(r.mint)}&outputMint=${encodeURIComponent(
                              WSOL_MINT
                            )}`}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs hover:bg-white/10"
                          >
                            Sell
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {!loading && connected && rows.length === 0 && (
                  <p className="py-6 text-sm text-zinc-300">No tokens found.</p>
                )}
              </div>

              <p className="mt-4 text-xs text-zinc-500">
                Tip: If a token shows no USD value, it may not have a reliable live price yet.
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
