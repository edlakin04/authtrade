"use client";

import React, { useEffect, useState } from "react";
import TopNav from "@/components/TopNav";
import Link from "next/link";

type TrendingCoin = {
  id: string;
  dev_wallet: string;
  token_address: string;
  title: string | null;
  description: string | null;
  created_at: string;
  upvotes_count: number;
  upvotes_24h?: number;
  comments_count: number;
  viewer_has_upvoted?: boolean;
};

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [following, setFollowing] = useState<any>(null);

  const [trendingCoins, setTrendingCoins] = useState<TrendingCoin[] | null>(null);
  const [trendingCoinsErr, setTrendingCoinsErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/public/dashboard", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ error: "Failed to load" }));

    fetch("/api/following/feed", { cache: "no-store" })
      .then((r) => r.json())
      .then(setFollowing)
      .catch(() => setFollowing({ error: "Failed to load following feed" }));

    // NEW: fetch trending coins for the dashboard
    fetch("/api/coins?sort=trending", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error || "Failed to load trending coins");
        setTrendingCoins((j?.coins ?? []) as TrendingCoin[]);
      })
      .catch((e: any) => {
        setTrendingCoinsErr(e?.message ?? "Failed to load trending coins");
        setTrendingCoins([]);
      });
  }, []);

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">Trending devs, your following feed, and trending coins.</p>

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
                            <div className="text-sm font-semibold">{c.title ?? "Untitled coin"}</div>
                            <div className="mt-1 break-all font-mono text-xs text-zinc-400">{c.token_address}</div>
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

            {/* CHANGED: Trending coins instead of New coins */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Trending coins</h2>
              <div className="mt-4 grid gap-2">
                {trendingCoinsErr ? (
                  <div className="text-sm text-red-300">{trendingCoinsErr}</div>
                ) : trendingCoins == null ? (
                  <div className="text-sm text-zinc-400">Loading…</div>
                ) : trendingCoins.length === 0 ? (
                  <div className="text-sm text-zinc-500">No coins yet.</div>
                ) : (
                  trendingCoins.slice(0, 12).map((c) => (
                    <div key={c.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{c.title ?? "Untitled coin"}</div>
                          <div className="mt-1 break-all font-mono text-xs text-zinc-400">{c.token_address}</div>

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                            <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                              👍 {c.upvotes_count}
                            </span>
                            <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                              💬 {c.comments_count}
                            </span>
                            {typeof c.upvotes_24h === "number" ? (
                              <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">
                                ⏱ {c.upvotes_24h} / 24h
                              </span>
                            ) : null}
                          </div>

                          {c.description ? <div className="mt-2 text-xs text-zinc-300">{c.description}</div> : null}

                          <div className="mt-2 text-xs text-zinc-500">
                            Posted by{" "}
                            <Link href={`/dev/${c.dev_wallet}`} className="hover:text-white">
                              {c.dev_wallet}
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
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
