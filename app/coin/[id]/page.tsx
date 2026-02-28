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
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

// Better price formatting for tiny prices
function fmtPrice(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.01) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 10 })}`;
  if (abs > 0 && abs < 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

export default function CoinPage({ params }: { params: { id: string } }) {
  const coinId = params.id;

  const [viewerWallet, setViewerWallet] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [coin, setCoin] = useState<CoinDB | null>(null);

  const [live, setLive] = useState<Live | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  // dev display name
  const [devName, setDevName] = useState<string | null>(null);

  // comments + upvotes on coin page
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [voteBusy, setVoteBusy] = useState(false);

  const mint = useMemo(() => coin?.token_address ?? "", [coin?.token_address]);

  function devLabel(wallet: string) {
    return devName || shortAddr(wallet);
  }

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

  async function loadDevName(wallet: string) {
    if (!wallet) return;
    try {
      const res = await fetch(`/api/public/dev/${encodeURIComponent(wallet)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        const name = json?.profile?.display_name;
        setDevName(typeof name === "string" ? name : null);
      }
    } catch {
      // ignore
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
      // keep quiet but visible
      console.error(e);
    } finally {
      setCommentLoading(false);
    }
  }

  async function postComment() {
    if (!coin) return;
    if (!viewerWallet) return alert("Sign in first (Get Started) to comment.");

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
    await loadComments(coin.id);
    // bump count locally
    setCoin((prev) => (prev ? { ...prev, comments_count: prev.comments_count + 1 } : prev));
  }

  async function toggleUpvote() {
    if (!coin) return;
    if (!viewerWallet) return alert("Sign in first (Get Started) to upvote.");

    if (voteBusy) return;
    setVoteBusy(true);
    try {
      const endpoint = `/api/coins/${encodeURIComponent(coin.id)}/vote`;
      const method = coin.viewer_has_upvoted ? "DELETE" : "POST";

      const res = await fetch(endpoint, { method });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return alert(json?.error ?? "Vote failed");

      const nowUpvoted = !coin.viewer_has_upvoted;
      setCoin((prev) =>
        prev
          ? {
              ...prev,
              viewer_has_upvoted: nowUpvoted,
              upvotes_count: Math.max(0, prev.upvotes_count + (nowUpvoted ? 1 : -1))
            }
          : prev
      );
    } finally {
      setVoteBusy(false);
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

  // initial load coin
  useEffect(() => {
    if (!coinId) return;
    loadCoin(coinId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinId]);

  // load dev name + comments when coin loads
  useEffect(() => {
    if (!coin) return;
    loadDevName(coin.dev_wallet);
    loadComments(coin.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin?.id]);

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
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {live?.image ? <img src={live.image} alt="" className="h-full w-full object-cover" /> : null}
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
                          title={coin.dev_wallet}
                        >
                          {devLabel(coin.dev_wallet)}
                        </Link>
                        {devName ? (
                          <span className="ml-2 font-mono text-[11px] text-zinc-500">{shortAddr(coin.dev_wallet)}</span>
                        ) : null}
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
                </div>
              </div>

              {coin.description ? (
                <p className="mt-4 text-sm text-zinc-300">{coin.description}</p>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">No description.</p>
              )}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs text-zinc-400">Price</p>
                <p className="mt-2 text-lg font-semibold">{fmtPrice(live?.priceUsd ?? null)}</p>
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

            {/* Community (upvote + comments on coin page) */}
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Community</h2>
                  <p className="mt-1 text-sm text-zinc-400">Upvote and discuss this coin.</p>
                </div>

                <button
                  onClick={toggleUpvote}
                  disabled={!viewerWallet || voteBusy}
                  className={[
                    "rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:opacity-60",
                    coin.viewer_has_upvoted
                      ? "bg-white text-black border-white"
                      : "bg-white/5 text-white border-white/10 hover:bg-white/10"
                  ].join(" ")}
                >
                  👍 {coin.upvotes_count}
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
