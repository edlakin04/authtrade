"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

type CoinRow = {
  id: string;
  dev_wallet: string;
  token_address: string;
  title: string | null;
  description: string | null;
  created_at: string;
  upvotes_count: number;
  upvotes_24h: number;
  comments_count: number;
  viewer_has_upvoted: boolean;
};

type CommentRow = {
  id: string;
  coin_id: string;
  author_wallet: string;
  comment: string;
  created_at: string;
};

type CoinMeta = {
  mint: string;
  name: string | null;
  symbol: string | null;
  image: string | null;
};

function shortAddr(s: string) {
  if (!s) return "";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function normalizeMeta(json: any, mint: string): CoinMeta {
  return {
    mint,
    name: typeof json?.name === "string" ? json.name : null,
    symbol: typeof json?.symbol === "string" ? json.symbol : null,
    image: typeof json?.image === "string" ? json.image : null
  };
}

export default function CoinsPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [viewerWallet, setViewerWallet] = useState<string | null>(null);
  const [coins, setCoins] = useState<CoinRow[]>([]);

  const [sort, setSort] = useState<"trending" | "newest">("trending");
  const [q, setQ] = useState("");

  // comments modal state
  const [openCoin, setOpenCoin] = useState<CoinRow | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentText, setCommentText] = useState("");

  // metadata cache (mint -> meta)
  const [metaByMint, setMetaByMint] = useState<Record<string, CoinMeta>>({});
  const [metaLoading, setMetaLoading] = useState(false);

  const qs = useMemo(() => {
    const u = new URLSearchParams();
    u.set("sort", sort);
    if (q.trim()) u.set("q", q.trim());
    return u.toString();
  }, [sort, q]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/coins?${qs}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to load coins");

      setViewerWallet(json.viewerWallet ?? null);
      setCoins((json.coins ?? []) as CoinRow[]);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load coins");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  // Fetch name/symbol/logo for visible coins (no batch route needed)
  useEffect(() => {
    let cancelled = false;

    async function fetchOne(mint: string) {
      try {
        const res = await fetch(`/api/coin-live?mint=${encodeURIComponent(mint)}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) return null;
        return normalizeMeta(json, mint);
      } catch {
        return null;
      }
    }

    async function run() {
      if (!coins || coins.length === 0) return;

      const uniqueMints = Array.from(new Set(coins.map((c) => c.token_address).filter(Boolean)));
      const missing = uniqueMints.filter((m) => !metaByMint[m]);

      if (missing.length === 0) return;

      setMetaLoading(true);

      // simple concurrency limiter
      const limit = 6;
      let i = 0;

      const next = async (): Promise<void> => {
        if (cancelled) return;
        const mint = missing[i++];
        if (!mint) return;

        const meta = await fetchOne(mint);
        if (!cancelled && meta) {
          setMetaByMint((prev) => ({ ...prev, [mint]: meta }));
        }

        if (i < missing.length) await next();
      };

      const starters = Array.from({ length: Math.min(limit, missing.length) }, () => next());
      await Promise.all(starters);

      if (!cancelled) setMetaLoading(false);
    }

    run();

    return () => {
      cancelled = true;
    };
    // we intentionally depend on `coins` and `metaByMint`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coins]);

  async function toggleUpvote(c: CoinRow) {
    if (!viewerWallet) {
      alert("Sign in first (Get Started) to upvote.");
      return;
    }

    const endpoint = `/api/coins/${encodeURIComponent(c.id)}/vote`;
    const method = c.viewer_has_upvoted ? "DELETE" : "POST";

    const res = await fetch(endpoint, { method });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return alert(json?.error ?? "Vote failed");

    // optimistic update
    setCoins((prev) =>
      prev.map((x) => {
        if (x.id !== c.id) return x;
        const nowUpvoted = !x.viewer_has_upvoted;
        return {
          ...x,
          viewer_has_upvoted: nowUpvoted,
          upvotes_count: Math.max(0, x.upvotes_count + (nowUpvoted ? 1 : -1))
        };
      })
    );
  }

  async function openComments(c: CoinRow) {
    setOpenCoin(c);
    setComments([]);
    setCommentText("");

    setCommentLoading(true);
    try {
      const res = await fetch(`/api/coins/${encodeURIComponent(c.id)}/comments`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to load comments");

      setComments((json.comments ?? []) as CommentRow[]);
    } catch (e: any) {
      alert(e?.message ?? "Failed to load comments");
    } finally {
      setCommentLoading(false);
    }
  }

  async function postComment() {
    if (!openCoin) return;
    if (!viewerWallet) {
      alert("Sign in first (Get Started) to comment.");
      return;
    }

    const comment = commentText.trim();
    if (comment.length < 2) return alert("Comment too short");

    const res = await fetch(`/api/coins/${encodeURIComponent(openCoin.id)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }) // matches your schema
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) return alert(json?.error ?? "Comment failed");

    setCommentText("");
    await openComments(openCoin);

    setCoins((prev) =>
      prev.map((x) => (x.id === openCoin.id ? { ...x, comments_count: x.comments_count + 1 } : x))
    );
  }

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Coins</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Upvote and discuss coins posted by devs.
              {metaLoading ? <span className="ml-2 text-xs text-zinc-500">Loading logos…</span> : null}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="w-64 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
              placeholder="Search title or token address…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <button
              onClick={() => setSort("trending")}
              className={[
                "rounded-xl px-4 py-2 text-sm border",
                sort === "trending"
                  ? "bg-white text-black border-white"
                  : "bg-white/5 text-white border-white/10 hover:bg-white/10"
              ].join(" ")}
            >
              Trending
            </button>

            <button
              onClick={() => setSort("newest")}
              className={[
                "rounded-xl px-4 py-2 text-sm border",
                sort === "newest"
                  ? "bg-white text-black border-white"
                  : "bg-white/5 text-white border-white/10 hover:bg-white/10"
              ].join(" ")}
            >
              Newest
            </button>
          </div>
        </div>

        {err && (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-200">
            {err}
          </div>
        )}

        {loading ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : (
          <div className="mt-6 grid gap-3">
            {coins.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-400">
                No coins found.
              </div>
            ) : (
              coins.map((c) => {
                const meta = metaByMint[c.token_address];
                const displayName = meta?.name || c.title || "Untitled coin";
                const ticker = meta?.symbol ? meta.symbol : null;

                return (
                  <div key={c.id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {meta?.image ? (
                              <img src={meta.image} alt="" className="h-full w-full object-cover" />
                            ) : null}
                          </div>

                          <div className="min-w-0">
                            <div className="truncate text-lg font-semibold">
                              {displayName}
                              {ticker ? <span className="ml-2 text-zinc-400">({ticker})</span> : null}
                            </div>
                            <div className="mt-0.5 break-all font-mono text-xs text-zinc-400">{c.token_address}</div>
                          </div>
                        </div>

                        {c.description ? (
                          <div className="mt-3 text-sm text-zinc-300">{c.description}</div>
                        ) : (
                          <div className="mt-3 text-sm text-zinc-500">No description.</div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                          <span>Dev: {shortAddr(c.dev_wallet)}</span>
                          <span>•</span>
                          <span>{new Date(c.created_at).toLocaleString()}</span>

                          <span>•</span>
                          <Link href={`/coin/${encodeURIComponent(c.id)}`} className="text-zinc-200 hover:text-white">
                            View coin →
                          </Link>

                          <span>•</span>
                          <Link
                            href={`/dev/${encodeURIComponent(c.dev_wallet)}`}
                            className="text-zinc-200 hover:text-white"
                          >
                            View dev →
                          </Link>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col gap-2">
                        <button
                          onClick={() => toggleUpvote(c)}
                          className={[
                            "rounded-xl px-4 py-2 text-sm font-semibold border transition",
                            c.viewer_has_upvoted
                              ? "bg-white text-black border-white"
                              : "bg-white/5 text-white border-white/10 hover:bg-white/10"
                          ].join(" ")}
                        >
                          👍 {c.upvotes_count}
                        </button>

                        <button
                          onClick={() => openComments(c)}
                          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                        >
                          💬 {c.comments_count}
                        </button>

                        <Link
                          href={`/trade?outputMint=${encodeURIComponent(c.token_address)}`}
                          className="rounded-xl bg-white px-4 py-2 text-center text-sm font-semibold text-black hover:bg-zinc-200"
                        >
                          Trade
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Comments modal */}
      {openCoin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">Comments</h2>
                <p className="mt-1 break-all font-mono text-xs text-zinc-400">{openCoin.token_address}</p>
              </div>

              <button
                onClick={() => setOpenCoin(null)}
                className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <textarea
                className="min-h-[90px] w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                placeholder={viewerWallet ? "Write a comment…" : "Sign in to comment (Get Started)."}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                disabled={!viewerWallet}
              />

              <button
                onClick={postComment}
                disabled={!viewerWallet || commentText.trim().length < 2}
                className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-50"
              >
                Post comment
              </button>
            </div>

            <div className="mt-5">
              {commentLoading ? (
                <div className="text-sm text-zinc-400">Loading…</div>
              ) : comments.length === 0 ? (
                <div className="text-sm text-zinc-500">No comments yet.</div>
              ) : (
                <div className="max-h-[380px] space-y-2 overflow-auto pr-1">
                  {comments.map((cm) => (
                    <div key={cm.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                        <span className="font-mono">{shortAddr(cm.author_wallet)}</span>
                        <span>{new Date(cm.created_at).toLocaleString()}</span>
                      </div>

                      <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">
                        {cm.comment}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
