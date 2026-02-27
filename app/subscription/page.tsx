"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import TopNav from "@/components/TopNav";
import Link from "next/link";

type SubscriptionStatus =
  | {
      ok: true;
      wallet: string;
      subscribedActive: boolean;
      expiresAt: string | null; // ISO
      autoRenew: boolean | null;
    }
  | { ok: false; error: string };

export default function SubscriptionPage() {
  const { publicKey, connected } = useWallet();
  const wallet = useMemo(() => publicKey?.toBase58() ?? "", [publicKey]);

  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<SubscriptionStatus | null>(null);

  async function load() {
    if (!connected || !wallet) return;

    setLoading(true);
    setErr(null);

    try {
      const res = await fetch(`/api/subscription/status?wallet=${encodeURIComponent(wallet)}`, {
        cache: "no-store"
      });

      const json = (await res.json().catch(() => null)) as SubscriptionStatus | null;
      if (!res.ok || !json) throw new Error((json as any)?.error || "Failed to load subscription");

      setData(json);
    } catch (e: any) {
      setErr(e?.message || "Failed to load subscription");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, wallet]);

  async function cancel() {
    if (!wallet) return;

    setCanceling(true);
    setErr(null);

    try {
      const res = await fetch("/api/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet })
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to cancel");

      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to cancel");
    } finally {
      setCanceling(false);
    }
  }

  const expiresText =
    (data as any)?.expiresAt ? new Date((data as any).expiresAt).toLocaleString() : "—";

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-lg px-6 py-10">
        <h1 className="text-2xl font-semibold">Subscription</h1>
        <p className="mt-1 text-sm text-zinc-400">Manage your Authswap access.</p>

        {!connected && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-zinc-300">Connect a wallet to view subscription details.</p>
            <p className="mt-2 text-xs text-zinc-500">
              Use the Get Started flow on the home page to connect.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
            >
              Go to home
            </Link>
          </div>
        )}

        {connected && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-400">Wallet</p>
                <p className="mt-1 font-mono text-sm">{wallet}</p>
              </div>
              {loading && <span className="text-xs text-zinc-400">Loading…</span>}
            </div>

            {err && (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-200">{err}</p>
              </div>
            )}

            {data && (data as any).ok && (
              <div className="mt-5 grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs text-zinc-400">Status</p>
                  <p className="mt-1 text-sm">
                    {(data as any).subscribedActive ? "Active" : "Inactive"}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs text-zinc-400">Expires</p>
                  <p className="mt-1 text-sm">{expiresText}</p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs text-zinc-400">Auto renew</p>
                  <p className="mt-1 text-sm">
                    {(data as any).autoRenew === null
                      ? "—"
                      : (data as any).autoRenew
                      ? "On"
                      : "Off"}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs text-zinc-400">Cancel</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Cancel stops auto-renew. You keep access until expiry.
                  </p>
                  <button
                    onClick={cancel}
                    disabled={canceling || (data as any).autoRenew === false}
                    className="mt-3 w-full rounded-2xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 disabled:opacity-60"
                  >
                    {(data as any).autoRenew === false
                      ? "Canceled"
                      : canceling
                      ? "Canceling…"
                      : "Cancel subscription"}
                  </button>
                </div>

                {!((data as any).subscribedActive) && (
                  <Link
                    href="/?subscribe=1"
                    className="rounded-2xl bg-white px-4 py-3 text-center text-sm font-semibold text-black hover:bg-zinc-200"
                  >
                    Start subscription
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
