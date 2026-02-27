"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

type CoinDB = {
  id: string;
  dev_wallet: string;
  token_address: string;
  title: string | null;
  description: string | null;
  created_at: string;
  upvotes_count: number;
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

type Live = {
  ok: true;
  mint: string;
  name: string | null;
  symbol: string | null;
  image: string | null;

  priceUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;

  pairUrl: string | null;
  dexId: string | null;
  quoteSymbol: string | null;
  updatedAt?: string;
  note?: string;
};

function shortAddr(s: string) {
  if (!s) return "";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

/**
 * Micro-price formatting:
 * - prevents 0.00 for tiny coins
 */
function fmtPriceUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n <= 0) return "$0";

  const abs = Math.abs(n);
  let decimals = 2;

  if (abs >= 1) decimals = 2;
  else if (abs >= 0.01) decimals = 4;
  else if (abs >= 0.0001) decimals = 6;
  else decimals = 10;

  const s = n
    .toFixed(decimals)
    .replace(/(\.\d*?[1-9])0+$/g, "$1")
    .replace(/\.0+$/g, "");

  return `$${s}`;
}

function normalizeImageUrl(url: string | null | undefined) {
  if (!url) return null;
  const u = url.trim();
  if (!u) return null;

  if (u.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${u.replace("ipfs://", "")}`;
  if (u.startsWith("ar://")) return `https://arweave.net/${u.replace("ar://", "")}`;

  if (u.startsWith("http://") || u.startsWith("https://")) return u;

  // best-effort: sometimes a raw CID is stored
  if (/^[a-zA-Z0-9]{40,}$/.test(u)) return `https://ipfs.io/ipfs/${u}`;

  return u;
}

function initials(name?: string | null, symbol?: string | null) {
  const base = (symbol || name || "").trim();
  if (!base) return "?";
  const parts = base.split(/[\s\-_]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function CoinPage({ params }: { params: Promise<{ id: string }> }) {
  const [coinId, setCoinId] = useState<string>("");

  const [viewerWallet, setViewerWallet] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [coin, setCoin] = useState<CoinDB | null>(null);

  const [live, setLive] = useState<Live | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  // comments state (ON PAGE)
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentText, setCommentText] = useState("");

  // resolve params (your project expects params as Promise)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await params;
        if (!alive) return;
        setCoinId(p.id);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [params]);

  const mint = useMemo(() => coin?.token_address ?? "", [coin?.token_address]);

  const logoUrl = useMemo(() => normalizeImageUrl(live?.image), [live?.image]);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  async function loadCoin(id: string) {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/coin/${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to load coin");

      setViewerWallet(json.viewerWallet ?? null);
      setCoin(json.coin as CoinDB);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load coin");
    } finally {
      setLoading(false);
    }
  }

  async function loadLive(m: string) {
    if (!m) return;
    setLiveLoading(true);
    setLiveErr(null);
    try {
      const res = await fetch(`/api/coin-live?mint=${encodeURIComponent(m)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to load live data");
      setLive(json as Live);
    } catch (e: any) {
      setLiveErr(e?.message ?? "Failed to load live data");
    } finally {
      setLiveLoading(false);
    }
  }

  async function loadComments(id: string) {
    setCommentLoading(true);
    try {
      const res = await fetch(`/api/coins/${encodeURIComponent(id)}/comments`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to load comments");
      setComments((json.comments ?? []) as CommentRow[]);
    } catch (e: any) {
      // keep it non-fatal
      console.error(e);
      setComments([]);
    } finally {
      setCommentLoading(false);
    }
  }

  async function toggleUpvote() {
    if (!coin) return;
    if (!viewerWallet) {
      alert("Sign in first (Get Started) to upvote.");
      return;
    }

    const endpoint = `/api/coins/${encodeURIComponent(coin.id)}/vote`;
    const method = coin.viewer_has_upvoted ? "DELETE" : "POST";

    const res = await fetch(endpoint, { method });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return alert(json?.error ?? "Vote failed");

    // optimistic update on coin local state
    setCoin((prev) => {
      if (!prev) return prev;
      const nowUpvoted = !prev.viewer_has_upvoted;
      return {
        ...prev,
        viewer_has_upvoted: nowUpvoted,
        upvotes_count: Math.max(0, prev.upvotes_count + (nowUpvoted ? 1 : -1))
      };
    });
  }

  async function postComment() {
    if (!coin) return;
    if (!viewerWallet) {
      alert("Sign in first (Get Started) to comment.");
      return;
    }

    const comment = commentText.trim();
    if (comment.length < 2) return alert("Comment too short");

    const res = await fetch(`/api/coins/${encodeURIComponent(coin.id)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment })
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) return alert(json?.error ?? "Comment failed");

    setCommentText("");

    // refresh comments
    await loadComments(coin.id);

    // bump comments count (best-effort optimistic)
    setCoin((prev) => (prev ? { ...prev, comments_count: prev.comments_count + 1 } : prev));
  }

  // initial load
  useEffect(() => {
    if (!coinId) return;
    loadCoin(coinId);
    loadComments(coinId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinId]);

  // live load + polling every 30s
  useEffect(() => {
    if (!mint) return;

    let alive = true;

    (async () => {
      if (!alive) return;
      await loadLive(mint);
    })();

    const t = setInterval(() => {
      if (!alive) return;
      loadLive(mint);
    }, 30_000);

    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint]);

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link href="/coins" className="text-sm text-zinc-400 hover:text-white">
          ← Back to coins
        </Link>

        {loading ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : err ? (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-200">
            {err}
          </div>
        ) : !coin ? null : (
          <>
            {/* HEADER */}
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {!logoFailed && logoUrl ? (
                      <img
                        src={logoUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={() => setLogoFailed(true)}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-zinc-200">
                        {initials(live?.name, live?.symbol)}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <h1 className="text-2xl font-semibold">
                      {live?.name || coin.title || "Coin"}
                      {live?.symbol ? <span className="ml-2 text-zinc-400">({live.symbol})</span> : null}
                    </h1>

                    <div className="mt-1 break-all font-mono text-xs text-zinc-400">{coin.token_address}</div>

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                      <span>
                        Dev:{" "}
                        <Link
                          href={`/dev/${encodeURIComponent(coin.dev_wallet)}`}
                          className="text-zinc-200 hover:text-white"
                        >
                          {shortAddr(coin.dev_wallet)}
                        </Link>
                      </span>
                      <span>•</span>
                      <span>{new Date(coin.created_at).toLocaleString()}</span>
                      {live?.dexId ? (
                        <>
                          <span>•</span>
                          <span className="uppercase">{live.dexId}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  <Link
                    href={`/trade?outputMint=${encodeURIComponent(coin.token_address)}`}
                    className="rounded-xl bg-white px-4 py-2 text-center text-sm font-semibold text-black hover:bg-zinc-200"
                  >
                    Trade
                  </Link>

                  {live?.pairUrl ? (
                    <a
                      href={live.pairUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center text-sm hover:bg-white/10"
                    >
                      View on DexScreener ↗
                    </a>
                  ) : (
                    <button
                      disabled
                      className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center text-sm opacity-60"
                    >
                      DexScreener unavailable
                    </button>
                  )}

                  <button
                    onClick={toggleUpvote}
                    className={[
                      "rounded-xl px-4 py-2 text-sm font-semibold border transition",
                      coin.viewer_has_upvoted
                        ? "bg-white text-black border-white"
                        : "bg-white/5 text-white border-white/10 hover:bg-white/10"
                    ].join(" ")}
                  >
                    👍 {coin.upvotes_count}
                  </button>
                </div>
              </div>

              {coin.description ? (
                <p className="mt-4 text-sm text-zinc-300">{coin.description}</p>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">No description.</p>
              )}
            </div>

            {/* METRICS */}
            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">Price</p>
                <p className="mt-2 text-lg font-semibold">{fmtPriceUsd(live?.priceUsd ?? null)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">Liquidity</p>
                <p className="mt-2 text-lg font-semibold">{fmtUsd(live?.liquidityUsd ?? null)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">Market cap</p>
                <p className="mt-2 text-lg font-semibold">{fmtUsd(live?.marketCapUsd ?? null)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">Volume 24h</p>
                <p className="mt-2 text-lg font-semibold">{fmtUsd(live?.volume24hUsd ?? null)}</p>
              </div>
            </div>

            <div className="mt-4 text-xs text-zinc-500">
              {liveLoading ? "Refreshing live data…" : liveErr ? `Live data error: ${liveErr}` : null}
              {!liveLoading && !liveErr && live?.updatedAt ? (
                <span className="ml-2">Last updated: {new Date(live.updatedAt).toLocaleTimeString()}</span>
              ) : null}
              {live?.note ? <div className="mt-1">{live.note}</div> : null}
            </div>

            {/* COMMENTS (like before) */}
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Comments</h2>
                  <p className="mt-1 text-sm text-zinc-400">Discuss this coin with the community.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm">
                  💬 {coin.comments_count}
                </div>
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
                  <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                    {comments.map((cm) => (
                      <div key={cm.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                          <span className="font-mono">{shortAddr(cm.author_wallet)}</span>
                          <span>{new Date(cm.created_at).toLocaleString()}</span>
                        </div>

                        <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">{cm.comment}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
