"use client";

import React, { useEffect, useMemo, useState } from "react";
import TopNav from "@/components/TopNav";
import Link from "next/link";

type DevPayload = {
  ok: true;
  viewerWallet: string | null;
  isFollowing: boolean;
  profile: {
    wallet: string;
    display_name: string;
    bio: string | null;
    pfp_url: string | null;
    x_url: string | null;
    updated_at: string;
  };
  posts: { id: string; wallet: string; content: string; created_at: string }[];
  coins: {
    id: string;
    wallet: string;
    token_address: string;
    title: string | null;
    description: string | null;
    created_at: string;
  }[];
};

type ReviewsPayload = {
  ok: true;
  dev_wallet: string;
  count: number;
  avgRating: number | null;
  reviews: Array<{
    id: string;
    dev_wallet: string;
    reviewer_wallet: string;
    reviewer_name?: string | null;
    reviewer_pfp_url?: string | null;
    rating: number;
    comment: string | null;
    created_at: string;
    updated_at: string;
  }>;
};

type LiveMeta = {
  ok: true;
  mint: string;
  name: string | null;
  symbol: string | null;
  image: string | null;
};

function shortWallet(w: string) {
  if (!w) return "";
  return w.slice(0, 4) + "…" + w.slice(-4);
}

function Stars({ value }: { value: number }) {
  const full = Math.floor(value);
  const frac = value - full;

  return (
    <div className="flex items-center gap-0.5" aria-label={`${value} stars`}>
      {Array.from({ length: 5 }).map((_, i) => {
        const idx = i + 1;
        const isFull = idx <= full;
        const isHalf = !isFull && idx === full + 1 && frac >= 0.25;

        return (
          <span
            key={i}
            className={[
              "text-sm",
              isFull ? "text-yellow-300" : isHalf ? "text-yellow-300/70" : "text-white/20"
            ].join(" ")}
          >
            ★
          </span>
        );
      })}
    </div>
  );
}

function StarPicker({
  value,
  onChange,
  disabled
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => {
        const n = i + 1;
        const active = n <= value;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            className={[
              "text-lg leading-none transition disabled:opacity-60",
              active ? "text-yellow-300" : "text-white/25 hover:text-white/50"
            ].join(" ")}
            aria-label={`${n} star`}
            title={`${n} star`}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

export default function DevPublicPage({ params }: { params: Promise<{ wallet: string }> }) {
  const [devWallet, setDevWallet] = useState<string>("");

  const [data, setData] = useState<DevPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pfpUrl, setPfpUrl] = useState<string | null>(null);

  const [reviews, setReviews] = useState<ReviewsPayload | null>(null);
  const [reviewsErr, setReviewsErr] = useState<string | null>(null);
  const [reviewsBusy, setReviewsBusy] = useState(false);

  const [myRating, setMyRating] = useState<number>(5);
  const [myComment, setMyComment] = useState<string>("");
  const [submitBusy, setSubmitBusy] = useState(false);

  const [metaByMint, setMetaByMint] = useState<Record<string, LiveMeta | null>>({});
  const [metaLoadingMints, setMetaLoadingMints] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const p = await params;
      setDevWallet(p.wallet);
    })();
  }, [params]);

  const shortDevWallet = useMemo(() => shortWallet(devWallet), [devWallet]);

  async function loadPfp(wallet: string) {
    const w = (wallet || "").trim();
    if (!w) return;
    try {
      const res = await fetch(`/api/public/pfp?wallet=${encodeURIComponent(w)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setPfpUrl(null);
        return;
      }
      setPfpUrl((json?.url ?? null) as string | null);
    } catch {
      setPfpUrl(null);
    }
  }

  async function loadDev(wallet: string) {
    setErr(null);
    const res = await fetch(`/api/public/dev/${encodeURIComponent(wallet)}`, { cache: "no-store" });
    const json = await res.json().catch(() => null);

    if (!res.ok) {
      setErr(json?.error ?? "Failed to load dev");
      setData(null);
      return;
    }

    setData(json);
    await loadPfp(wallet);
  }

  async function loadReviews(wallet: string) {
    setReviewsErr(null);
    setReviewsBusy(true);
    try {
      const res = await fetch(`/api/public/dev/${encodeURIComponent(wallet)}/reviews`, {
        cache: "no-store"
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setReviewsErr(json?.error ?? "Failed to load reviews");
        setReviews(null);
        return;
      }
      setReviews(json as ReviewsPayload);
    } finally {
      setReviewsBusy(false);
    }
  }

  useEffect(() => {
    if (!devWallet) return;
    loadDev(devWallet);
    loadReviews(devWallet);
    loadPfp(devWallet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devWallet]);

  useEffect(() => {
    if (!data?.viewerWallet || !reviews?.reviews) return;
    const mine = reviews.reviews.find((r) => r.reviewer_wallet === data.viewerWallet);
    if (!mine) return;

    setMyRating(Number(mine.rating) || 5);
    setMyComment((mine.comment ?? "").toString());
  }, [data?.viewerWallet, reviews?.reviews]);

  async function toggleFollow() {
    if (!data || !devWallet) return;

    if (!data.viewerWallet) {
      alert("Sign in first (Get Started) to follow devs.");
      return;
    }

    setBusy(true);
    try {
      const endpoint = data.isFollowing ? "/api/unfollow" : "/api/follow";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devWallet })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json?.error ?? "Action failed");
        return;
      }

      await loadDev(devWallet);
    } finally {
      setBusy(false);
    }
  }

  async function submitReview() {
    if (!data?.viewerWallet) {
      alert("Sign in first (Get Started) to leave a review.");
      return;
    }
    if (!devWallet) return;

    if (data.viewerWallet === devWallet) {
      alert("You can’t review yourself.");
      return;
    }

    setSubmitBusy(true);
    try {
      const res = await fetch(`/api/public/dev/${encodeURIComponent(devWallet)}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: myRating,
          comment: myComment
        })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json?.error ?? "Review failed");
        return;
      }

      await loadReviews(devWallet);
      alert("Review saved.");
    } finally {
      setSubmitBusy(false);
    }
  }

  async function fetchCoinMeta(mint: string) {
    const m = (mint || "").trim();
    if (!m) return;

    if (Object.prototype.hasOwnProperty.call(metaByMint, m)) return;

    setMetaLoadingMints((prev) => ({ ...prev, [m]: true }));
    try {
      const res = await fetch(`/api/coin-live?mint=${encodeURIComponent(m)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setMetaByMint((prev) => ({ ...prev, [m]: null }));
        return;
      }

      const meta = json as LiveMeta;
      setMetaByMint((prev) => ({ ...prev, [m]: meta }));
    } finally {
      setMetaLoadingMints((prev) => ({ ...prev, [m]: false }));
    }
  }

  async function fetchCoinMetaBatched(mints: string[], batchSize = 6) {
    const uniq = Array.from(new Set(mints.filter(Boolean).map((x) => x.trim())));
    const need = uniq.filter((m) => !Object.prototype.hasOwnProperty.call(metaByMint, m));
    if (need.length === 0) return;

    for (let i = 0; i < need.length; i += batchSize) {
      const chunk = need.slice(i, i + batchSize);
      await Promise.allSettled(chunk.map((m) => fetchCoinMeta(m)));
    }
  }

  useEffect(() => {
    if (!data?.coins?.length) return;
    const visible = data.coins.slice(0, 30).map((c) => c.token_address);
    fetchCoinMetaBatched(visible, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.coins]);

  const avg = reviews?.avgRating ?? null;
  const count = reviews?.count ?? 0;

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
              ← Back to dashboard
            </Link>
            <h1 className="mt-3 text-2xl font-semibold">Dev</h1>
            <p className="mt-1 font-mono text-xs text-zinc-500">{devWallet || "…"}</p>
          </div>

          <button
            onClick={toggleFollow}
            disabled={!data || busy}
            className={[
              "rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-60",
              data?.isFollowing
                ? "bg-white/10 text-white hover:bg-white/15 border border-white/10"
                : "bg-white text-black hover:bg-zinc-200"
            ].join(" ")}
          >
            {busy ? "…" : data?.isFollowing ? "Following" : "Follow"}
          </button>
        </div>

        {err ? (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-200">
            {err}
          </div>
        ) : !data ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : (
          <>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 overflow-hidden rounded-full border border-white/10 bg-white/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {pfpUrl ? <img src={pfpUrl} alt="" className="h-full w-full object-cover" /> : null}
                  </div>

                  <div className="min-w-0">
                    <div className="text-lg font-semibold">{data.profile.display_name}</div>
                    <div className="mt-1 text-xs text-zinc-400">Wallet: {shortDevWallet}</div>
                    {data.profile.x_url ? (
                      <a
                        href={data.profile.x_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs text-zinc-300 hover:text-white"
                      >
                        X/Twitter ↗
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="text-2xl font-semibold">{avg == null ? "—" : avg.toFixed(2)}</div>
                    <div>
                      <Stars value={avg ?? 0} />
                      <div className="mt-1 text-xs text-zinc-400">
                        {count} review{count === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {data.profile.bio ? (
                <p className="mt-4 text-sm text-zinc-300">{data.profile.bio}</p>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">No bio yet.</p>
              )}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Reviews</h2>
                  {reviewsBusy ? <span className="text-xs text-zinc-400">Loading…</span> : null}
                </div>

                {reviewsErr ? (
                  <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
                    {reviewsErr}
                  </div>
                ) : null}

                <div className="mt-4 space-y-2">
                  {reviews?.reviews?.length ? (
                    reviews.reviews.slice(0, 12).map((r) => {
                      const name = (r.reviewer_name || "").trim() || shortWallet(r.reviewer_wallet);
                      return (
                        <div key={r.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-white/10 bg-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {r.reviewer_pfp_url ? (
                                  <img src={r.reviewer_pfp_url} alt="" className="h-full w-full object-cover" />
                                ) : null}
                              </div>

                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{name}</div>
                                <div className="font-mono text-[11px] text-zinc-500">{shortWallet(r.reviewer_wallet)}</div>
                              </div>
                            </div>

                            <Stars value={Number(r.rating) || 0} />
                          </div>

                          {r.comment ? (
                            <div className="mt-2 text-sm text-zinc-200">{r.comment}</div>
                          ) : (
                            <div className="mt-2 text-sm text-zinc-500">No comment.</div>
                          )}
                          <div className="mt-2 text-[11px] text-zinc-500">{new Date(r.created_at).toLocaleString()}</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm text-zinc-500">No reviews yet.</div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-lg font-semibold">Leave a review</h2>

                {!data.viewerWallet ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-zinc-300">
                    Sign in via <span className="text-white">Get Started</span> to leave a review.
                  </div>
                ) : data.viewerWallet === devWallet ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-zinc-300">
                    You can’t review yourself.
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-zinc-200">Your rating</div>
                      <StarPicker value={myRating} onChange={setMyRating} disabled={submitBusy} />
                    </div>

                    <textarea
                      className="mt-3 min-h-[110px] w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                      placeholder="Share your experience (optional)…"
                      value={myComment}
                      onChange={(e) => setMyComment(e.target.value)}
                      maxLength={2000}
                    />

                    <button
                      onClick={submitReview}
                      disabled={submitBusy}
                      className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                    >
                      {submitBusy ? "Saving…" : "Submit review"}
                    </button>

                    <p className="mt-2 text-xs text-zinc-500">
                      One review per wallet. Submitting again updates your existing review.
                    </p>
                  </div>
                )}
              </section>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-lg font-semibold">Updates</h2>
                <div className="mt-4 space-y-2">
                  {data.posts.length === 0 ? (
                    <div className="text-sm text-zinc-500">No updates yet.</div>
                  ) : (
                    data.posts.slice(0, 20).map((p) => (
                      <div key={p.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <div className="text-xs text-zinc-500">{new Date(p.created_at).toLocaleString()}</div>
                        <div className="mt-1 text-sm text-zinc-200">{p.content}</div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-lg font-semibold">Coins</h2>
                <div className="mt-4 space-y-2">
                  {data.coins.length === 0 ? (
                    <div className="text-sm text-zinc-500">No coins yet.</div>
                  ) : (
                    data.coins.slice(0, 30).map((c) => {
                      const mint = c.token_address;
                      const meta = metaByMint[mint];
                      const loadingMeta = !!metaLoadingMints[mint];

                      const displayName = meta?.name || c.title || "Untitled coin";
                      const symbol = meta?.symbol || null;
                      const logo = meta?.image || null;

                      return (
                        <div key={c.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {logo ? (
                                  <img src={logo} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                                    {loadingMeta ? "…" : "⎔"}
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-sm font-semibold">{displayName}</div>
                                  {symbol ? (
                                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-300">
                                      {symbol}
                                    </span>
                                  ) : null}
                                  {loadingMeta ? <span className="text-[11px] text-zinc-500">Loading…</span> : null}
                                  <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-300">
                                    Permanent
                                  </span>
                                </div>

                                <div className="mt-1 break-all font-mono text-xs text-zinc-400">{c.token_address}</div>
                                {c.description ? <div className="mt-2 text-xs text-zinc-300">{c.description}</div> : null}
                                <div className="mt-2 text-[11px] text-zinc-500">
                                  {new Date(c.created_at).toLocaleString()}
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
          </>
        )}
      </div>
    </main>
  );
}
