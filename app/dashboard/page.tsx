"use client";

import React, { useEffect, useMemo, useState } from "react";
import TopNav from "@/components/TopNav";
import Link from "next/link";

type Meta = {
  name: string | null;
  symbol: string | null;
  image: string | null;
};

function initials(name: string) {
  const n = (name || "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.slice(0, 1).toUpperCase()).join("");
}

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [following, setFollowing] = useState<any>(null);

  const [metaByMint, setMetaByMint] = useState<Record<string, Meta>>({});

  useEffect(() => {
    fetch("/api/public/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ error: "Failed to load" }));

    fetch("/api/following/feed")
      .then((r) => r.json())
      .then(setFollowing)
      .catch(() => setFollowing({ error: "Failed to load following feed" }));
  }, []);

  const allMints = useMemo(() => {
    const m: string[] = [];

    for (const c of (data?.coins ?? []) as any[]) {
      if (c?.token_address) m.push(String(c.token_address));
    }

    for (const c of (following?.coins ?? []) as any[]) {
      if (c?.token_address) m.push(String(c.token_address));
    }

    return Array.from(new Set(m)).slice(0, 50);
  }, [data, following]);

  useEffect(() => {
    if (allMints.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/coin-live/batch?mints=${encodeURIComponent(allMints.join(","))}`, {
          cache: "no-store"
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) return;

        if (!cancelled && json?.byMint) {
          setMetaByMint((prev) => ({ ...prev, ...(json.byMint as Record<string, Meta>) }));
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allMints]);

  function renderCoinIdentity(tokenAddress: string, fallbackTitle?: string | null) {
    const meta = metaByMint[tokenAddress];
    const displayName = meta?.name || fallbackTitle || "Untitled coin";
    const symbol = meta?.symbol;

    return (
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 overflow-hidden rounded-xl border border-white/10 bg-black/30 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {meta?.image ? (
            <img src={meta.image} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[11px] text-zinc-300">{initials(symbol || displayName)}</span>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-semibold">{displayName}</div>
            {symbol ? (
              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-zinc-300">
                {symbol}
              </span>
            ) : null}
          </div>
          <div className="mt-1 break-all font-mono text-xs text-zinc-400">{tokenAddress}</div>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">Trending devs, your following feed, and newly posted coins.</p>

        {/* FOLLOWING FEED */}
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-lg font-semibold">Following</h2>
          <p className="mt-1 text-sm text-zinc-400">Updates + coins from devs you follow.</p>

          {!following ? (
            <div className="mt-4 text-zinc-400">Loading…</div>
          ) : following.error ? (
            <div className="mt-4 text-red-300">{following.error}</div>
          ) : (following.devWallets ?? []).length === 0 ? (
            <div className="mt-4 text-sm text-zinc-500">
              You’re not following anyone yet. Click a dev below to follow them.
            </div>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-semibold">Latest updates</div>
                <div className="mt-3 space-y-2">
                  {(following.posts ?? []).length === 0 ? (
                    <div className="text-sm text-zinc-500">No updates from followed devs yet.</div>
                  ) : (
                    (following.posts ?? []).slice(0, 8).map((x: any) => (
                      <div key={x.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <Link
                          href={`/dev/${x.wallet}`}
                          className="font-mono text-[11px] text-zinc-500 hover:text-white"
                        >
                          {x.wallet}
                        </Link>
                        <div className="mt-1 text-sm text-zinc-200">{x.content}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-semibold">Latest coins</div>
                <div className="mt-3 space-y-2">
                  {(following.coins ?? []).length === 0 ? (
                    <div className="text-sm text-zinc-500">No coins from followed devs yet.</div>
                  ) : (
                    (following.coins ?? []).slice(0, 8).map((c: any) => (
                      <div key={c.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {renderCoinIdentity(String(c.token_address), c.title ?? null)}
                            <div className="mt-1 text-xs text-zinc-500">
                              by{" "}
                              <Link href={`/dev/${c.wallet}`} className="hover:text-white">
                                {c.wallet}
                              </Link>
                            </div>
                          </div>

                          <div className="shrink-0">
                            <Link
                              href={`/coin/${encodeURIComponent(c.id)}`}
                              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                            >
                              Open →
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* MAIN FEED */}
        {!data ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : data.error ? (
          <div className="mt-6 text-red-300">{data.error}</div>
        ) : (
          <div className="mt-6 grid gap-6">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Trending devs</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {(data.profiles ?? []).length === 0 ? (
                  <div className="text-sm text-zinc-500">No dev profiles yet.</div>
                ) : (
                  (data.profiles ?? []).map((p: any) => (
                    <Link
                      key={p.wallet}
                      href={`/dev/${p.wallet}`}
                      className="rounded-xl border border-white/10 bg-black/30 p-4 hover:bg-black/40 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 overflow-hidden rounded-full border border-white/10 bg-white/5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {p.pfp_url ? <img src={p.pfp_url} alt="" className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{p.display_name}</div>
                          <div className="truncate font-mono text-[11px] text-zinc-500">{p.wallet}</div>
                        </div>
                      </div>
                      {p.bio ? <div className="mt-3 text-xs text-zinc-300">{p.bio}</div> : null}
                    </Link>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Latest updates</h2>
              <div className="mt-4 space-y-2">
                {(data.posts ?? []).length === 0 ? (
                  <div className="text-sm text-zinc-500">No updates yet.</div>
                ) : (
                  (data.posts ?? []).slice(0, 10).map((x: any) => (
                    <div key={x.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <Link href={`/dev/${x.wallet}`} className="font-mono text-[11px] text-zinc-500 hover:text-white">
                        {x.wallet}
                      </Link>
                      <div className="mt-1 text-sm text-zinc-200">{x.content}</div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">New coins</h2>
              <div className="mt-4 grid gap-2">
                {(data.coins ?? []).length === 0 ? (
                  <div className="text-sm text-zinc-500">No coins posted yet.</div>
                ) : (
                  (data.coins ?? []).slice(0, 12).map((c: any) => (
                    <div key={c.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {renderCoinIdentity(String(c.token_address), c.title ?? null)}
                          <div className="mt-1 text-xs text-zinc-500">
                            Posted by{" "}
                            <Link href={`/dev/${c.wallet}`} className="hover:text-white">
                              {c.wallet}
                            </Link>
                          </div>
                          {c.description ? <div className="mt-2 text-xs text-zinc-300">{c.description}</div> : null}
                        </div>

                        <div className="shrink-0">
                          <Link
                            href={`/coin/${encodeURIComponent(c.id)}`}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                          >
                            Open →
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
