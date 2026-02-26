"use client";

import React, { useEffect, useState } from "react";

export default function CoinsPage() {
  const [q, setQ] = useState("");
  const [coins, setCoins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/public/coins?q=${encodeURIComponent(q)}`);
    const data = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      alert(data?.error ?? "Failed to load coins");
      return;
    }
    setCoins(data.coins ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-authswap text-white">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Coins</h1>
        <p className="mt-1 text-sm text-zinc-400">All posted coins. Buying/selling comes later via Jupiter UI.</p>

        <div className="mt-6 flex gap-3">
          <input
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
            placeholder="Search token address or title…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            onClick={load}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
          >
            Search
          </button>
        </div>

        {loading ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : (
          <div className="mt-6 grid gap-2">
            {coins.length === 0 ? (
              <div className="text-sm text-zinc-500">No coins found.</div>
            ) : (
              coins.map((c) => (
                <div key={c.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{c.title ?? "Untitled coin"}</div>
                      <div className="mt-1 break-all font-mono text-xs text-zinc-400">{c.token_address}</div>
                      {c.description ? <div className="mt-2 text-xs text-zinc-300">{c.description}</div> : null}
                      <div className="mt-2 text-xs text-zinc-500">Posted by {c.wallet}</div>
                    </div>
                    <button
                      disabled
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-400"
                      title="Jupiter trading added later"
                    >
                      Buy/Sell (soon)
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}
