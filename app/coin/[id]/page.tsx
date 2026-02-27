"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

type CoinDetails = {
  ok: true;
  viewerWallet: string | null;
  coin: {
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
  comments: Array<{
    id: string;
    coin_id: string;
    author_wallet: string;
    comment: string;
    created_at: string;
  }>;
};

function shortAddr(s: string) {
  if (!s) return "";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export default function CoinPage({ params }: { params: Promise<{ id: string }> }) {
  const [coinId, setCoinId] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [data, setData] = useState<CoinDetails | null>(null);

  const viewerWallet = useMemo(() => data?.viewerWallet ?? null, [data]);

  useEffect(() => {
    (async () => {
      const p = await params;
      setCoinId(p.id);
    })();
  }, [params]);

  async function load(id: string) {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/coins/${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to load coin");

      setData(json as CoinDetails);
    } catch (e: any) {
      setErr(e?.message || "Failed to load coin");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (coinId) load(coinId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinId]);

  async function toggleUpvote() {
    if (!data?.coin) return;

    if (!viewerWallet) {
      alert("Sign in first (Get Started) to upvote.");
      return;
    }

    const endpoint = `/api/coins/${encodeURIComponent(data.coin.id)}/vote`;
    const method = data.coin.viewer_has_upvoted ? "DELETE" : "POST";

    const res = await fetch(endpoint, { method });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return alert(json?.error ?? "Vote failed");

    // optimistic
    setData((prev) => {
      if (!prev) return prev;
      const nowUpvoted = !prev.coin.viewer_has_upvoted;
      return {
        ...prev,
        coin: {
          ...prev.coin,
          viewer_has_upvoted: nowUpvoted,
          upvotes_count: Math.max(0, prev.coin.upvotes_count + (nowUpvoted ? 1 : -1))
        }
      };
    });
  }

  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);

  async function postComment() {
    if (!data?.coin) return;

    if (!viewerWallet) {
      alert("Sign in first (Get Started) to comment.");
      return;
    }

    const comment = commentText.trim();
    if (comment.length < 2) return alert("Comment too short");

    setPosting(true);
    try {
      const res = await fetch(`/api/coins/${encodeURIComponent(data.coin.id)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) return alert(json?.error ?? "Comment failed");

      setCommentText("");
      await load(data.coin.id);
    } finally {
      setPosting(false);
    }
  }

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/coins" className="text-sm text-zinc-400 hover:text-white">
              ← Back to coins
            </Link>
            <h1 className="mt-3 text-2xl font-semibold">Coin</h1>
            <p className="mt-1 text-sm text-zinc-400">Details + discussion</p>
          </div>

          {data?.coin ? (
            <Link
              href={`/trade?outputMint=${encodeURIComponent(data.coin.token_address)}`}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
            >
              Trade
            </Link>
          ) : null}
        </div>

        {err ? (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-200">
            {err}
          </div>
        ) : loading ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : !data?.coin ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-400">
            Coin not found.
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-lg font-semibold">{data.coin.title ?? "Untitled coin"}</div>
                  <div className="mt-1 break-all font-mono text-xs text-zinc-400">{data.coin.token_address}</div>

                  {data.coin.description ? (
                    <div className="mt-3 text-sm text-zinc-300">{data.coin.description}</div>
                  ) : (
                    <div className="mt-3 text-sm text-zinc-500">No description.</div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                    <span>Posted: {new Date(data.coin.created_at).toLocaleString()}</span>
                    <span>•</span>
                    <span>Dev: {shortAddr(data.coin.dev_wallet)}</span>
                    <span>•</span>
                    <Link
                      href={`/dev/${encodeURIComponent(data.coin.dev_wallet)}`}
                      className="text-zinc-200 hover:text-white"
                    >
                      View dev →
                    </Link>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    onClick={toggleUpvote}
                    className={[
                      "rounded-xl px-4 py-2 text-sm font-semibold border transition",
                      data.coin.viewer_has_upvoted
                        ? "bg-white text-black border-white"
                        : "bg-white/5 text-white border-white/10 hover:bg-white/10"
                    ].join(" ")}
                  >
                    👍 {data.coin.upvotes_count}
                  </button>

                  <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-zinc-200">
                    💬 {data.coin.comments_count}
                  </div>
                </div>
              </div>
            </div>

            {/* Comments */}
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Comments</h2>

              <div className="mt-4">
                <textarea
                  className="min-h-[90px] w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder={viewerWallet ? "Write a comment…" : "Sign in to comment (Get Started)."}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  disabled={!viewerWallet || posting}
                />
                <button
                  onClick={postComment}
                  disabled={!viewerWallet || posting || commentText.trim().length < 2}
                  className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-50"
                >
                  {posting ? "Posting…" : "Post comment"}
                </button>
              </div>

              <div className="mt-5 space-y-2">
                {data.comments.length === 0 ? (
                  <div className="text-sm text-zinc-500">No comments yet.</div>
                ) : (
                  data.comments.map((cm) => (
                    <div key={cm.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                        <span className="font-mono">{shortAddr(cm.author_wallet)}</span>
                        <span>{new Date(cm.created_at).toLocaleString()}</span>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">{cm.comment}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
