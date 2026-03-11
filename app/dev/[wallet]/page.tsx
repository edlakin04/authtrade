"use client";

import React, { useEffect, useMemo, useState } from "react";
import TopNav from "@/components/TopNav";
import Link from "next/link";
import TrialBanner from "@/components/TrialBanner";

type PollOption = {
  id: string;
  label: string;
  votes: number;
};

type Poll = {
  id: string;
  question: string;
  options: PollOption[];
  viewer_vote?: string | null; // option_id or null
};

type DevPayload = {
  ok: true;
  viewerWallet: string | null;
  isFollowing: boolean;
  followersCount: number; // ✅ NEW
  profile: {
    wallet: string;
    display_name: string;
    bio: string | null;
    pfp_url: string | null;
    x_url: string | null;
    updated_at: string;
  };
  posts: {
    id: string;
    wallet: string;
    content: string;
    created_at: string;
    image_path?: string | null;
    image_url?: string | null;

    // ✅ NEW: optional poll attached to dev update post
    poll?: Poll | null;
  }[];
  coins: {
    id: string;
    wallet: string;
    token_address: string;
    title: string | null;
    description: string | null;
    created_at: string;
    is_collab?: boolean;
    collab_devs?: { wallet: string; display_name: string | null; pfp_url: string | null }[];
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

type Holding = {
  mint: string;
  uiAmount: number;
  usdPrice: number | null;
  usdValue: number | null;
  coin: {
    id: string;
    title: string | null;
    token_address: string;
  };
};

type HoldingsPayload = {
  ok: true;
  sol: number;
  solUsdPrice: number | null;
  solUsdValue: number | null;
  totalUsd: number | null;
  holdings: Holding[];
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
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);

  const [reviews, setReviews] = useState<ReviewsPayload | null>(null);
  const [reviewsErr, setReviewsErr] = useState<string | null>(null);
  const [reviewsBusy, setReviewsBusy] = useState(false);

  const [myRating, setMyRating] = useState<number>(5);
  const [myComment, setMyComment] = useState<string>("");
  const [submitBusy, setSubmitBusy] = useState(false);

  const [metaByMint, setMetaByMint] = useState<Record<string, LiveMeta | null>>({});
  const [metaLoadingMints, setMetaLoadingMints] = useState<Record<string, boolean>>({});

  // ✅ poll vote busy keyed by poll id
  const [pollVoteBusyById, setPollVoteBusyById] = useState<Record<string, boolean>>({});

  // Trial state
  const [isTrial, setIsTrial] = useState(false);

  // Holdings
  const [holdings, setHoldings] = useState<HoldingsPayload | null>(null);
  const [holdingsLoading, setHoldingsLoading] = useState(false);

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

  async function loadBanner(wallet: string) {
    const w = (wallet || "").trim();
    if (!w) return;
    try {
      const res = await fetch(`/api/public/banner?wallet=${encodeURIComponent(w)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBannerUrl(null);
        return;
      }
      setBannerUrl((json?.url ?? null) as string | null);
    } catch {
      setBannerUrl(null);
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

    setData(json as DevPayload);
    await loadPfp(wallet);
    await loadBanner(wallet);
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

  async function loadHoldings(wallet: string) {
    setHoldingsLoading(true);
    try {
      const res = await fetch(`/api/public/wallet/${encodeURIComponent(wallet)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok) setHoldings(json as HoldingsPayload);
    } finally {
      setHoldingsLoading(false);
    }
  }

  useEffect(() => {
    if (!devWallet) return;
    // Fetch trial state from context
    fetch("/api/context/refresh", { method: "POST" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.ok) setIsTrial(!!d.isTrial); })
      .catch(() => null);
  }, [devWallet]);

  useEffect(() => {
    if (!devWallet) return;
    loadDev(devWallet);
    loadReviews(devWallet);
    loadHoldings(devWallet);
    loadPfp(devWallet);
    loadBanner(devWallet);
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
        if (json?.code === "TRIAL_RESTRICTED") { window.location.href = "/?subscribe=1&trial_upgrade=1"; return; }
        alert(json?.error ?? "Action failed");
        return;
      }

      await loadDev(devWallet); // ✅ refresh follower count too
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
        if (json?.code === "TRIAL_RESTRICTED") { window.location.href = "/?subscribe=1&trial_upgrade=1"; return; }
        alert(json?.error ?? "Review failed");
        return;
      }

      await loadReviews(devWallet);
      alert("Review saved.");
    } finally {
      setSubmitBusy(false);
    }
  }

  // ✅ vote on a poll attached to a dev update post
  async function voteDevPostPoll(pollId: string, optionId: string) {
    if (!data?.viewerWallet) {
      alert("Sign in first (Get Started) to vote.");
      return;
    }

    setPollVoteBusyById((prev) => ({ ...prev, [pollId]: true }));
    try {
      const res = await fetch(`/api/dev/posts/polls/${encodeURIComponent(pollId)}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option_id: optionId })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json?.error ?? "Vote failed");
        return;
      }

      await loadDev(devWallet);
    } finally {
      setPollVoteBusyById((prev) => ({ ...prev, [pollId]: false }));
    }
  }

  function PollCard({ poll }: { poll: Poll }) {
    const total = (poll.options ?? []).reduce((sum, o) => sum + (Number(o.votes) || 0), 0);
    const voteBusy = !!pollVoteBusyById[poll.id];

    return (
      <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
        <div className="text-sm font-semibold text-zinc-100">{poll.question}</div>

        <div className="mt-2 space-y-2">
          {(poll.options ?? []).map((o) => {
            const votes = Number(o.votes) || 0;
            const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
            const voted = poll.viewer_vote === o.id;

            return (
              <button
                key={o.id}
                type="button"
                disabled={voteBusy}
                onClick={() => voteDevPostPoll(poll.id, o.id)}
                className={[
                  "w-full overflow-hidden rounded-xl border border-white/10 p-2 text-left disabled:opacity-60",
                  voted ? "bg-white/10" : "bg-black/30 hover:bg-black/40"
                ].join(" ")}
                title={voted ? "You voted for this" : "Vote"}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-sm text-zinc-200">{o.label}</div>
                  <div className="shrink-0 text-[11px] text-zinc-400">
                    {pct}% • {votes}
                  </div>
                </div>

                <div className="mt-2 h-2 w-full rounded-full bg-black/40">
                  <div className="h-2 rounded-full bg-white" style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-2 text-[11px] text-zinc-500">
          {voteBusy ? "Updating…" : `${total} total vote${total === 1 ? "" : "s"}`}
        </div>
      </div>
    );
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
  const followersCount = data?.followersCount ?? 0;

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      {/* ✅ Banner at very top (under nav) */}
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
          {bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bannerUrl} alt="" className="h-40 w-full object-cover sm:h-48" />
          ) : (
            <div className="flex h-40 w-full items-center justify-center text-sm text-zinc-500 sm:h-48">
              No banner
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <TrialBanner isTrial={isTrial} />
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

                {/* ✅ Reviews + Followers */}
                <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <div className="text-2xl font-semibold">{avg == null ? "—" : avg.toFixed(2)}</div>
                      <div>
                        <Stars value={avg ?? 0} />
                        <div className="mt-1 text-xs text-zinc-400">
                          {count} review{count === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>

                    <div className="h-10 w-px bg-white/10" />

                    <div className="text-right">
                      <div className="text-2xl font-semibold">{followersCount}</div>
                      <div className="mt-1 text-xs text-zinc-400">
                        follower{followersCount === 1 ? "" : "s"}
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
                                <a
                                  href={`/user/${encodeURIComponent(r.reviewer_wallet)}`}
                                  className="truncate text-sm font-semibold hover:underline block"
                                >
                                  {name}
                                </a>
                                <a
                                  href={`/user/${encodeURIComponent(r.reviewer_wallet)}`}
                                  className="font-mono text-[11px] text-zinc-500 hover:text-zinc-300"
                                >
                                  {shortWallet(r.reviewer_wallet)}
                                </a>
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

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              {/* ── Holdings ──────────────────────────────────────────────── */}
              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-lg font-semibold">Holdings</h2>
                <p className="mt-0.5 text-xs text-zinc-500">Authswap coins &amp; SOL owned by this dev</p>

                <div className="mt-4 space-y-2">
                  {holdingsLoading && (
                    <div className="space-y-2">
                      {[1,2,3].map(i => (
                        <div key={i} className="animate-pulse h-14 rounded-xl border border-white/5 bg-white/[0.03]" />
                      ))}
                    </div>
                  )}

                  {!holdingsLoading && holdings && (
                    <>
                      {/* SOL row */}
                      {holdings.sol > 0 && (
                        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3">
                          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/40 flex items-center justify-center">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
                              alt="SOL"
                              className="h-6 w-6 object-contain"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold text-white">Solana</span>
                              <span className="rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-500">SOL</span>
                            </div>
                            <div className="text-[11px] text-zinc-500">
                              {holdings.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            {holdings.solUsdValue !== null ? (
                              <div className="text-xs font-semibold text-white">
                                {holdings.solUsdValue >= 1000
                                  ? `$${(holdings.solUsdValue/1000).toFixed(2)}K`
                                  : holdings.solUsdValue >= 1
                                  ? `$${holdings.solUsdValue.toFixed(2)}`
                                  : `$${holdings.solUsdValue.toFixed(4)}`}
                              </div>
                            ) : (
                              <div className="text-xs text-zinc-500">no price</div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Authswap coin rows */}
                      {holdings.holdings.length === 0 && holdings.sol === 0 && (
                        <div className="text-sm text-zinc-500">No Authswap holdings.</div>
                      )}
                      {holdings.holdings.length === 0 && holdings.sol > 0 && (
                        <div className="text-xs text-zinc-500 pt-1">No Authswap coins held.</div>
                      )}

                      {holdings.holdings.map((h) => {
                        const meta = metaByMint[h.mint];
                        const logo = meta?.image ?? null;
                        const name = meta?.name || h.coin.title || `${h.mint.slice(0,4)}…${h.mint.slice(-4)}`;
                        const symbol = meta?.symbol ?? null;
                        return (
                          <Link
                            key={h.mint}
                            href={`/coin/${encodeURIComponent(h.coin.id)}`}
                            className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3 hover:border-white/20 hover:bg-white/5 transition"
                          >
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5 flex items-center justify-center text-zinc-600 text-sm">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {logo ? <img src={logo} alt="" className="h-full w-full object-cover" /> : "⎔"}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-semibold text-white truncate">{name}</span>
                                {symbol && (
                                  <span className="rounded-full border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-500">{symbol}</span>
                                )}
                              </div>
                              <div className="text-[11px] text-zinc-500">
                                {h.uiAmount >= 1_000_000
                                  ? `${(h.uiAmount/1_000_000).toFixed(2)}M`
                                  : h.uiAmount >= 1_000
                                  ? `${(h.uiAmount/1_000).toFixed(2)}K`
                                  : h.uiAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {symbol ?? "tokens"}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              {h.usdValue !== null ? (
                                <div className="text-xs font-semibold text-white">
                                  {h.usdValue >= 1000
                                    ? `$${(h.usdValue/1000).toFixed(2)}K`
                                    : h.usdValue >= 1
                                    ? `$${h.usdValue.toFixed(2)}`
                                    : `$${h.usdValue.toFixed(4)}`}
                                </div>
                              ) : (
                                <div className="text-[11px] text-zinc-500">no price</div>
                              )}
                            </div>
                          </Link>
                        );
                      })}

                      {/* Total */}
                      {holdings.totalUsd !== null && holdings.totalUsd > 0 && (
                        <div className="mt-1 flex items-center justify-between border-t border-white/10 pt-2">
                          <span className="text-xs text-zinc-500">Authswap total</span>
                          <span className="text-xs font-semibold text-white">
                            {holdings.totalUsd >= 1000
                              ? `$${(holdings.totalUsd/1000).toFixed(2)}K`
                              : `$${holdings.totalUsd.toFixed(2)}`}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-lg font-semibold">Updates</h2>
                <div className="mt-4 space-y-2">
                  {data.posts.length === 0 ? (
                    <div className="text-sm text-zinc-500">No updates yet.</div>
                  ) : (
                    data.posts.slice(0, 20).map((p) => (
                      <div key={p.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <div className="text-xs text-zinc-500">{new Date(p.created_at).toLocaleString()}</div>

                        {p.content ? <div className="mt-1 text-sm text-zinc-200">{p.content}</div> : null}

                        {p.image_url ? (
                          <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/40">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.image_url} alt="" className="w-full max-h-[420px] object-cover" />
                          </div>
                        ) : null}

                        {p.poll ? <PollCard poll={p.poll} /> : null}
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
                      const isCollab = !!c.is_collab;
                      const collabDevs = c.collab_devs ?? [];

                      return (
                        <div key={c.id} className={[
                          "rounded-xl border p-4",
                          isCollab
                            ? "border-purple-500/20 bg-purple-500/5"
                            : "border-white/10 bg-black/30"
                        ].join(" ")}>
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
                                  {isCollab && (
                                    <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-[11px] text-purple-300">
                                      🤝 Collab
                                    </span>
                                  )}
                                  {loadingMeta ? <span className="text-[11px] text-zinc-500">Loading…</span> : null}
                                  <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-300">
                                    Permanent
                                  </span>
                                </div>

                                <div className="mt-1 break-all font-mono text-xs text-zinc-400">{c.token_address}</div>
                                {c.description ? <div className="mt-2 text-xs text-zinc-300">{c.description}</div> : null}

                                {/* Co-dev avatars for collab coins */}
                                {isCollab && collabDevs.length > 0 && (
                                  <div className="mt-2 flex items-center gap-1.5">
                                    <span className="text-[11px] text-zinc-500">With:</span>
                                    <div className="flex -space-x-1.5">
                                      {collabDevs.map((d) => (
                                        <Link
                                          key={d.wallet}
                                          href={`/dev/${encodeURIComponent(d.wallet)}`}
                                          title={d.display_name || d.wallet}
                                          className="relative h-6 w-6 overflow-hidden rounded-full border border-white/20 bg-white/5 hover:z-10 hover:ring-2 hover:ring-purple-400"
                                        >
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          {d.pfp_url ? (
                                            <img src={d.pfp_url} alt="" className="h-full w-full object-cover" />
                                          ) : (
                                            <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-400">
                                              {(d.display_name || d.wallet).slice(0, 1).toUpperCase()}
                                            </div>
                                          )}
                                        </Link>
                                      ))}
                                    </div>
                                    <span className="text-[11px] text-zinc-500">
                                      {collabDevs.map((d) => d.display_name || `${d.wallet.slice(0,4)}…${d.wallet.slice(-4)}`).join(", ")}
                                    </span>
                                  </div>
                                )}

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
