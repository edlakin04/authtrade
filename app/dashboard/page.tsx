"use client";

import React, { useEffect, useMemo, useState } from "react";
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
};

type FollowCoin = {
  id: string;
  wallet: string; // dev wallet in your following feed payload
  token_address: string;
  title: string | null;
  description: string | null;
  created_at?: string;
};

type CoinMeta = {
  name: string | null;
  symbol: string | null;
  image: string | null;
};

type NameMap = Record<string, string>; // wallet -> display_name

function shortAddr(s: string) {
  if (!s) return "";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [following, setFollowing] = useState<any>(null);

  const [trendingCoins, setTrendingCoins] = useState<TrendingCoin[] | null>(null);
  const [trendingCoinsErr, setTrendingCoinsErr] = useState<string | null>(null);

  // mint -> {name,symbol,image}
  const [metaByMint, setMetaByMint] = useState<Record<string, CoinMeta>>({});

  // wallet -> display_name
  const [nameByWallet, setNameByWallet] = useState<NameMap>({});

  useEffect(() => {
    fetch("/api/public/dashboard", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ error: "Failed to load" }));

    fetch("/api/following/feed", { cache: "no-store" })
      .then((r) => r.json())
      .then(setFollowing)
      .catch(() => setFollowing({ error: "Failed to load following feed" }));

    // Trending coins for dashboard
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

  // Seed name map from already-loaded trending dev profiles
  useEffect(() => {
    if (!data?.profiles?.length) return;
    setNameByWallet((prev) => {
      const next = { ...prev };
      for (const p of data.profiles as any[]) {
        if (p?.wallet && p?.display_name && !next[p.wallet]) next[p.wallet] = p.display_name;
      }
      return next;
    });
  }, [data?.profiles]);

  // Collect all wallets we need names for (posts/coins/following)
  const walletsToResolve = useMemo(() => {
    const s = new Set<string>();

    // dashboard posts: wallet
    for (const p of (data?.posts ?? []) as any[]) {
      if (p?.wallet) s.add(String(p.wallet));
    }

    // trending coins: dev_wallet
    for (const c of (trendingCoins ?? []) as any[]) {
      if (c?.dev_wallet) s.add(String(c.dev_wallet));
    }

    // following posts: wallet
    for (const p of (following?.posts ?? []) as any[]) {
      if (p?.wallet) s.add(String(p.wallet));
    }

    // following coins: wallet
    for (const c of (following?.coins ?? []) as any[]) {
      if (c?.wallet) s.add(String(c.wallet));
    }

    return Array.from(s);
  }, [data?.posts, trendingCoins, following?.posts, following?.coins]);

  // Resolve missing display_names via /api/public/dev/:wallet (cached in state)
  useEffect(() => {
    if (!walletsToResolve.length) return;

    let cancelled = false;

    async function run() {
      const missing = walletsToResolve.filter((w) => !nameByWallet[w]);
      if (missing.length === 0) return;

      // Limit concurrency
      const batchSize = 6;

      for (let i = 0; i < missing.length; i += batchSize) {
        const chunk = missing.slice(i, i + batchSize);

        const results = await Promise.allSettled(
          chunk.map(async (wallet) => {
            const res = await fetch(`/api/public/dev/${encodeURIComponent(wallet)}`, { cache: "no-store" });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(json?.error || "dev fetch failed");
            const name = json?.profile?.display_name;
            return { wallet, name: typeof name === "string" ? name : null };
          })
        );

        if (cancelled) return;

        const updates: NameMap = {};
        for (const r of results) {
          if (r.status === "fulfilled" && r.value.name) {
            updates[r.value.wallet] = r.value.name;
          }
        }

        if (Object.keys(updates).length) {
          setNameByWallet((prev) => ({ ...prev, ...updates }));
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsToResolve.join("|")]);

  function devLabel(wallet: string) {
    const name = nameByWallet[wallet];
    return name ? name : shortAddr(wallet);
  }

  function devSub(wallet: string) {
    const name = nameByWallet[wallet];
    return name ? shortAddr(wallet) : null;
  }

  const allMintsToHydrate = useMemo(() => {
    const t = (trendingCoins ?? []).slice(0, 12).map((c) => c.token_address).filter(Boolean);

    const f = ((following?.coins ?? []) as FollowCoin[])
      .slice(0, 8)
      .map((c) => c.token_address)
      .filter(Boolean);

    return Array.from(new Set([...t, ...f]));
  }, [trendingCoins, following?.coins]);

  // Load logo/name/ticker for coins shown on dashboard
  useEffect(() => {
    if (!allMintsToHydrate.length) return;

    let cancelled = false;

    async function run() {
      const missing = allMintsToHydrate.filter((m) => !metaByMint[m]);
      if (missing.length === 0) return;

      const batchSize = 6;

      for (let i = 0; i < missing.length; i += batchSize) {
        const chunk = missing.slice(i, i + batchSize);

        const results = await Promise.allSettled(
          chunk.map(async (mint) => {
            const res = await fetch(`/api/coin-live?mint=${encodeURIComponent(mint)}`, { cache: "no-store" });
            const json = await res.json().catch(() => null);
            if (!res.ok) throw new Error(json?.error || "coin-live failed");

            return {
              mint,
              name: json?.name ?? null,
              symbol: json?.symbol ?? null,
              image: json?.image ?? null
            } as { mint: string } & CoinMeta;
          })
        );

        if (cancelled) return;

        const nextMeta: Record<string, CoinMeta> = {};
        for (const r of results) {
          if (r.status === "fulfilled") {
            nextMeta[r.value.mint] = { name: r.value.name, symbol: r.value.symbol, image: r.value.image };
          }
        }

        if (Object.keys(nextMeta).length) {
          setMetaByMint((prev) => ({ ...prev, ...nextMeta }));
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMintsToHydrate.join("|")]);

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
                          href={`/dev/${encodeURIComponent(x.wallet)}`}
                          className="text-sm font-semibold text-zinc-200 hover:text-white"
                          title={x.wallet}
                        >
                          {devLabel(x.wallet)}
                        </Link>

                        {devSub(x.wallet) ? (
                          <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{devSub(x.wallet)}</div>
                        ) : null}

                        <div className="mt-2 text-sm text-zinc-200">{x.content}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* FOLLOWING COINS */}
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-semibold">Latest coins</div>
                <div className="mt-3 space-y-2">
                  {(following.coins ?? []).length === 0 ? (
                    <div className="text-sm text-zinc-500">No coins from followed devs yet.</div>
                  ) : (
                    (following.coins ?? []).slice(0, 8).map((c: FollowCoin) => {
                      const meta = metaByMint[c.token_address];
                      const displayName = meta?.name || c.title || "Coin";
                      const symbol = meta?.symbol || null;

                      return (
                        <div key={c.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex items-start gap-3">
                              <div className="mt-0.5 h-9 w-9 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {meta?.image ? <img src={meta.image} alt="" className="h-full w-full object-cover" /> : null}
                              </div>

                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-sm font-semibold truncate">{displayName}</div>
                                  {symbol ? (
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">
                                      {symbol}
                                    </span>
                                  ) : null}
                                </div>

                                <div className="mt-1 break-all font-mono text-xs text-zinc-400">{c.token_address}</div>

                                <div className="mt-1 text-xs text-zinc-500">
                                  by{" "}
                                  <Link
                                    href={`/dev/${encodeURIComponent(c.wallet)}`}
                                    className="hover:text-white"
                                    title={c.wallet}
                                  >
                                    {devLabel(c.wallet)}
                                  </Link>
                                  {devSub(c.wallet) ? (
                                    <span className="ml-2 font-mono text-[11px] text-zinc-600">{devSub(c.wallet)}</span>
                                  ) : null}
                                </div>
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
                      );
                    })
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
                      <Link
                        href={`/dev/${encodeURIComponent(x.wallet)}`}
                        className="text-sm font-semibold text-zinc-200 hover:text-white"
                        title={x.wallet}
                      >
                        {devLabel(x.wallet)}
                      </Link>

                      {devSub(x.wallet) ? (
                        <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{devSub(x.wallet)}</div>
                      ) : null}

                      <div className="mt-2 text-sm text-zinc-200">{x.content}</div>
                    </div>
                  ))
                )}
              </div>
            </section>

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
                  trendingCoins.slice(0, 12).map((c) => {
                    const meta = metaByMint[c.token_address];
                    const displayName = meta?.name || c.title || "Coin";
                    const symbol = meta?.symbol || null;

                    return (
                      <div key={c.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex items-start gap-3">
                            <div className="mt-0.5 h-10 w-10 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {meta?.image ? <img src={meta.image} alt="" className="h-full w-full object-cover" /> : null}
                            </div>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold truncate">{displayName}</div>
                                {symbol ? (
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">
                                    {symbol}
                                  </span>
                                ) : null}
                              </div>

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
                                <Link
                                  href={`/dev/${encodeURIComponent(c.dev_wallet)}`}
                                  className="hover:text-white"
                                  title={c.dev_wallet}
                                >
                                  {devLabel(c.dev_wallet)}
                                </Link>
                                {devSub(c.dev_wallet) ? (
                                  <span className="ml-2 font-mono text-[11px] text-zinc-600">{devSub(c.dev_wallet)}</span>
                                ) : null}
                              </div>
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
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
