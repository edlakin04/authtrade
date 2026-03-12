"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import UpgradeModal from "@/components/UpgradeModal";
import TrialBanner from "@/components/TrialBanner";

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
  author_name?: string | null;
  author_pfp_url?: string | null;
  is_dev?: boolean;
  comment: string;
  created_at: string;
};

type Live = {
  ok: true;
  mint: string;
  name: string | null;
  symbol: string | null;
  image: string | null;
  dexImage?: string | null;

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

type CoinCommunityResp = {
  ok: true;
  community: {
    id: string;
    coin_id: string;
    dev_wallet: string;
    title: string | null;
    created_at: string;
  } | null;
  viewerIsMember: boolean;
};

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ChartPayload = {
  ok: true;
  pairAddress: string | null;
  baseSymbol: string | null;
  quoteSymbol: string | null;
  resolution: string;
  candles: Candle[];
  priceChange: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  note?: string;
};

type Trade = {
  signature: string;
  blockTime: number;
  type: "buy" | "sell";
  walletAddress: string;
  tokenAmount: number;
  solAmount: number | null;
  usdAmount: number | null;
  priceUsd: number | null;
  source: string | null;
};

type TradesPayload = {
  ok: true;
  pairAddress: string | null;
  baseSymbol: string | null;
  trades: Trade[];
  txnCounts: {
    m5:  { buys: number; sells: number } | null;
    h1:  { buys: number; sells: number } | null;
    h6:  { buys: number; sells: number } | null;
    h24: { buys: number; sells: number } | null;
  };
};

function shortAddr(s: string) {
  if (!s) return "";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtPrice(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.0001) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 12 })}`;
  if (abs > 0 && abs < 0.01) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 10 })}`;
  if (abs > 0 && abs < 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

export default function CoinPage({ params }: { params: Promise<{ id: string }> }) {
  const [coinId, setCoinId] = useState<string>("");

  const [viewerWallet, setViewerWallet] = useState<string | null>(null);
  const [isTrial, setIsTrial] = useState(false);
  const [trialToast, setTrialToast] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [coin, setCoin] = useState<CoinDB | null>(null);

  const [live, setLive] = useState<Live | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  const [devName, setDevName] = useState<string | null>(null);

  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [voteBusy, setVoteBusy] = useState(false);

  const [commLoading, setCommLoading] = useState(false);
  const [community, setCommunity] = useState<CoinCommunityResp["community"]>(null);
  const [viewerIsMember, setViewerIsMember] = useState(false);
  const [commErr, setCommErr] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  // ✅ Coin banner (public signed url + optional owner upload)
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerLoading, setBannerLoading] = useState(false);

  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerUploading, setBannerUploading] = useState(false);

  // ── Chart state ─────────────────────────────────────────────────────────────
  const [chartData, setChartData] = useState<ChartPayload | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartResolution, setChartResolution] = useState<"5m" | "15m" | "1h" | "4h" | "1d">("15m");
  const [bottomTab, setBottomTab] = useState<"chart" | "trades" | "holders">("chart");

  // ── Trades state ─────────────────────────────────────────────────────────────
  const [tradesData, setTradesData] = useState<TradesPayload | null>(null);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [newTradeKeys, setNewTradeKeys] = useState<Set<string>>(new Set());

  // ── Holders state ─────────────────────────────────────────────────────────
  type Holder = { address: string; owner: string; amount: number; pct: number };
  type HoldersPayload = { ok: true; mint: string; totalSupply: number; holderCount: number; holders: Holder[]; decimals: number };
  const [holdersData, setHoldersData] = useState<HoldersPayload | null>(null);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [holdersErr, setHoldersErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = await params;
      setCoinId(p.id);
    })();
  }, [params]);

  const mint = useMemo(() => coin?.token_address ?? "", [coin?.token_address]);

  function devLabel(wallet: string) {
    return devName || shortAddr(wallet);
  }

  const logoUrl = useMemo(() => {
    return (live?.image || live?.dexImage || null) as string | null;
  }, [live?.image, live?.dexImage]);

  const viewerIsDevOwner = !!viewerWallet && !!coin && viewerWallet === coin.dev_wallet;

  const bannerPreview = useMemo(() => {
    if (!bannerFile) return null;
    return URL.createObjectURL(bannerFile);
  }, [bannerFile]);

  useEffect(() => {
    return () => {
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    };
  }, [bannerPreview]);

  async function loadCoin(id: string) {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/coin/${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to load coin");

      setViewerWallet(json.viewerWallet ?? null);
      setIsTrial(!!(json.isTrial ?? false));
      setCoin(json.coin as CoinDB);

      // ✅ fetch banner too
      await loadBanner(id);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load coin");
    } finally {
      setLoading(false);
    }
  }

  async function loadBanner(id: string) {
    setBannerLoading(true);
    try {
      const res = await fetch(`/api/public/coin/${encodeURIComponent(id)}/banner`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBannerUrl(null);
        return;
      }
      setBannerUrl((json?.url ?? null) as string | null);
    } catch {
      setBannerUrl(null);
    } finally {
      setBannerLoading(false);
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
    if (!res.ok) {
      if (json?.code === "TRIAL_RESTRICTED") { setTrialToast(true); return; }
      return alert(json?.error ?? "Comment failed");
    }

    setCommentText("");
    await loadComments(coin.id);

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
      if (!res.ok) {
        if (json?.code === "TRIAL_RESTRICTED") { setTrialToast(true); return; }
        return alert(json?.error ?? "Vote failed");
      }

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

  async function loadCommunity(coinIdToUse: string) {
    if (!coinIdToUse) return;
    setCommLoading(true);
    setCommErr(null);
    try {
      const res = await fetch(`/api/coin/${encodeURIComponent(coinIdToUse)}/community`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as CoinCommunityResp | null;
      if (!res.ok) throw new Error((json as any)?.error || "Failed to load community");
      setCommunity(json?.community ?? null);
      setViewerIsMember(!!json?.viewerIsMember);
    } catch (e: any) {
      setCommErr(e?.message ?? "Failed to load community");
      setCommunity(null);
      setViewerIsMember(false);
    } finally {
      setCommLoading(false);
    }
  }

  async function createCommunity() {
    if (!coin) return;
    if (!viewerWallet) return alert("Sign in first (Get Started).");
    if (viewerWallet !== coin.dev_wallet) return;

    const title = prompt("Community title (optional):")?.trim() ?? "";
    setCreateBusy(true);
    try {
      const res = await fetch(`/api/coin/${encodeURIComponent(coin.id)}/community`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || null })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Create failed");

      await loadCommunity(coin.id);
      if (json?.community?.id) {
        window.location.href = `/community/${encodeURIComponent(json.community.id)}`;
      }
    } catch (e: any) {
      alert(e?.message ?? "Create failed");
    } finally {
      setCreateBusy(false);
    }
  }

  // ✅ helper: validate banner image shape before upload (avoid square)
  async function validateBannerFile(file: File) {
    const MAX_BYTES = 15 * 1024 * 1024; // 15MB
    const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

    if (!ALLOWED.has(file.type)) {
      throw new Error("Invalid file type. Allowed: JPG, PNG, WEBP.");
    }
    if (file.size <= 0) throw new Error("Empty file.");
    if (file.size > MAX_BYTES) throw new Error("File too large (max 15MB).");

    // dimension + aspect ratio check
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error("Failed to read image dimensions."));
        img.src = url;
      });

      const ratio = dims.w / Math.max(1, dims.h);

      // banner-ish: wide. This blocks squares & portrait images.
      if (ratio < 1.6) {
        throw new Error("Banner must be wide (not square). Try ~1500×500 (3:1).");
      }
      if (ratio > 5.0) {
        throw new Error("Banner is too wide. Try ~1500×500 (3:1).");
      }

      // tiny banners look bad
      if (dims.w < 900 || dims.h < 250) {
        throw new Error("Banner is too small. Recommend at least ~900×250 (3.6:1).");
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadBanner() {
    if (!coin) return;
    if (!viewerIsDevOwner) return;
    if (!bannerFile) return;

    try {
      await validateBannerFile(bannerFile);
    } catch (e: any) {
      alert(e?.message ?? "Invalid banner file.");
      return;
    }

    setBannerUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", bannerFile);

      const res = await fetch(`/api/dev/coins/${encodeURIComponent(coin.id)}/banner`, {
        method: "POST",
        body: fd
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json?.error ?? "Upload failed");
        return;
      }

      setBannerFile(null);
      await loadBanner(coin.id);
    } finally {
      setBannerUploading(false);
    }
  }

  async function loadChart(m: string, res: string) {
    if (!m) return;
    setChartLoading(true);
    try {
      const r = await fetch(`/api/coin-chart?mint=${encodeURIComponent(m)}&resolution=${res}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok) setChartData(j as ChartPayload);
    } finally {
      setChartLoading(false);
    }
  }

  async function loadHolders(m: string) {
    if (!m) return;
    setHoldersLoading(true);
    setHoldersErr(null);
    try {
      const r = await fetch(`/api/coin-holders?mint=${encodeURIComponent(m)}`, { cache: "no-store" });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error(json?.error ?? "Failed to load holders");
      setHoldersData(json as HoldersPayload);
    } catch (e: any) {
      setHoldersErr(e?.message ?? "Failed to load holders");
    } finally {
      setHoldersLoading(false);
    }
  }

  async function loadTrades(m: string) {
    if (!m) return;
    setTradesLoading(true);
    try {
      const r = await fetch(`/api/coin-trades?mint=${encodeURIComponent(m)}&limit=50`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok) {
        const incoming = j as TradesPayload;
        // Highlight new trades that weren't in the previous load
        setTradesData((prev) => {
          if (prev) {
            const prevSigs = new Set(prev.trades.map((t) => t.signature));
            const newSigs = new Set(
              incoming.trades
                .filter((t) => !prevSigs.has(t.signature))
                .map((t) => t.signature)
            );
            if (newSigs.size > 0) {
              setNewTradeKeys(newSigs);
              setTimeout(() => setNewTradeKeys(new Set()), 2000);
            }
          }
          return incoming;
        });
      }
    } finally {
      setTradesLoading(false);
    }
  }

  useEffect(() => {
    if (!coinId) return;
    loadCoin(coinId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinId]);

  useEffect(() => {
    if (!coin) return;
    loadDevName(coin.dev_wallet);
    loadComments(coin.id);
    loadCommunity(coin.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin?.id]);

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

  // Chart polling — re-fetch when resolution changes or mint loads
  useEffect(() => {
    if (!mint) return;
    loadChart(mint, chartResolution);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint, chartResolution]);

  // Trades polling — every 10s for near-live feel
  useEffect(() => {
    if (!mint) return;
    let alive = true;

    (async () => {
      if (!alive) return;
      await loadTrades(mint);
    })();

    const t = setInterval(() => {
      if (!alive) return;
      loadTrades(mint);
    }, 10_000);

    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint]);

  // Re-poll chart every 30s (candles update)
  useEffect(() => {
    if (!mint) return;
    const t = setInterval(() => loadChart(mint, chartResolution), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint, chartResolution]);

  // Load holders when tab switches to "holders" (fetch once, no polling needed)
  useEffect(() => {
    if (bottomTab !== "holders" || !mint) return;
    if (holdersData?.mint === mint) return; // already loaded for this mint
    loadHolders(mint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomTab, mint]);

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <TrialBanner isTrial={isTrial} />
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
            {/* ✅ Banner */}
            <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
              {bannerPreview || bannerUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={bannerPreview || bannerUrl || ""}
                  alt=""
                  className="h-[180px] w-full object-cover md:h-[240px]"
                />
              ) : (
                <div className="flex h-[180px] w-full items-center justify-center text-sm text-zinc-500 md:h-[240px]">
                  {bannerLoading ? "Loading banner…" : "No banner"}
                </div>
              )}
            </div>

            {/* ✅ Owner upload UI */}
            {viewerIsDevOwner ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Coin banner</div>
                    <div className="mt-1 text-xs text-zinc-400">
                      JPG / PNG / WEBP • max 15MB • recommended 1500×500 (3:1)
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
                      Choose banner
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          setBannerFile(f);
                        }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={uploadBanner}
                      disabled={!bannerFile || bannerUploading}
                      className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                    >
                      {bannerUploading ? "Uploading…" : "Upload"}
                    </button>

                    {bannerFile ? (
                      <button
                        type="button"
                        onClick={() => setBannerFile(null)}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>

                {bannerFile ? (
                  <div className="mt-2 text-xs text-zinc-400">
                    {bannerFile.name} • {(bannerFile.size / (1024 * 1024)).toFixed(2)}MB
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {logoUrl ? (
                      <img src={logoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
                        No logo
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


            {/* ── Chart & Trades ───────────────────────────────────────────── */}
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
              {/* Tab bar */}
              <div className="flex items-center justify-between border-b border-white/10 px-4">
                <div className="flex">
                  {(["chart", "trades", "holders"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setBottomTab(tab)}
                      className={[
                        "px-4 py-3 text-sm font-semibold capitalize transition border-b-2 -mb-px",
                        bottomTab === tab
                          ? "border-white text-white"
                          : "border-transparent text-zinc-500 hover:text-zinc-300"
                      ].join(" ")}
                    >
                      {tab === "chart" ? "📈 Chart" : tab === "trades" ? "🔄 Trades" : "👥 Holders"}
                    </button>
                  ))}
                </div>

                {/* Resolution picker — only visible on chart tab */}
                {bottomTab === "chart" && (
                  <div className="flex items-center gap-1">
                    {(["5m", "15m", "1h", "4h", "1d"] as const).map((res) => (
                      <button
                        key={res}
                        onClick={() => setChartResolution(res)}
                        className={[
                          "rounded-lg px-2.5 py-1 text-xs font-mono transition",
                          chartResolution === res
                            ? "bg-white text-black"
                            : "text-zinc-500 hover:text-zinc-200"
                        ].join(" ")}
                      >
                        {res}
                      </button>
                    ))}
                    {chartLoading && (
                      <span className="ml-2 text-xs text-zinc-600">↻</span>
                    )}
                  </div>
                )}

                {/* Trades live indicator */}
                {bottomTab === "trades" && (
                  <div className="flex items-center gap-1.5 pr-1">
                    <span className={["h-1.5 w-1.5 rounded-full", tradesLoading ? "bg-yellow-400 animate-pulse" : "bg-green-400 animate-pulse"].join(" ")} />
                    <span className="text-xs text-zinc-500">Live · 10s</span>
                  </div>
                )}
              </div>

              {/* ── CHART TAB ──────────────────────────────────────────────── */}
              {bottomTab === "chart" && (
                <div className="p-4">
                  {/* Price change bar */}
                  {chartData?.priceChange && (
                    <div className="mb-4 flex flex-wrap gap-3">
                      {([["5m", chartData.priceChange.m5], ["1h", chartData.priceChange.h1], ["6h", chartData.priceChange.h6], ["24h", chartData.priceChange.h24]] as [string, number | null][]).map(([label, val]) => (
                        val !== null ? (
                          <div key={label} className="flex items-center gap-1.5">
                            <span className="text-xs text-zinc-500">{label}</span>
                            <span className={["text-xs font-semibold", val >= 0 ? "text-green-400" : "text-red-400"].join(" ")}>
                              {val >= 0 ? "+" : ""}{val.toFixed(2)}%
                            </span>
                          </div>
                        ) : null
                      ))}
                    </div>
                  )}

                  {/* No pair yet */}
                  {!chartLoading && (!chartData?.candles?.length) && (
                    <div className="flex h-[320px] items-center justify-center rounded-xl border border-white/5 bg-black/20">
                      <div className="text-center">
                        <div className="text-3xl mb-2">📊</div>
                        <div className="text-sm text-zinc-400">
                          {chartData?.note ?? "No chart data yet."}
                        </div>
                        <div className="mt-1 text-xs text-zinc-600">
                          Chart appears once trading begins on a DEX.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Loading skeleton */}
                  {chartLoading && !chartData?.candles?.length && (
                    <div className="flex h-[320px] items-center justify-center rounded-xl border border-white/5 bg-black/20">
                      <div className="text-sm text-zinc-600 animate-pulse">Loading chart…</div>
                    </div>
                  )}

                  {/* Canvas chart */}
                  {chartData?.candles?.length ? (
                    <CandlestickChart
                      candles={chartData.candles}
                      baseSymbol={chartData.baseSymbol}
                      quoteSymbol={chartData.quoteSymbol}
                    />
                  ) : null}

                  {chartData?.pairAddress && (
                    <div className="mt-2 text-right text-[11px] text-zinc-600">
                      Pool: <span className="font-mono">{shortAddr(chartData.pairAddress)}</span>
                      {chartData.quoteSymbol ? ` · ${chartData.baseSymbol ?? "TOKEN"}/${chartData.quoteSymbol}` : ""}
                    </div>
                  )}
                </div>
              )}

              {/* ── TRADES TAB ─────────────────────────────────────────────── */}
              {bottomTab === "trades" && (
                <div>
                  {/* Txn count summary bar */}
                  {tradesData?.txnCounts && (
                    <div className="flex flex-wrap gap-4 border-b border-white/5 px-4 py-2.5">
                      {(["m5", "h1", "h6", "h24"] as const).map((w) => {
                        const c = tradesData.txnCounts[w];
                        if (!c) return null;
                        const total = c.buys + c.sells;
                        const buyPct = total > 0 ? Math.round((c.buys / total) * 100) : 50;
                        return (
                          <div key={w} className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500">{w.toUpperCase()}</span>
                            <span className="text-xs text-green-400">{c.buys}B</span>
                            <span className="text-xs text-zinc-600">/</span>
                            <span className="text-xs text-red-400">{c.sells}S</span>
                            <div className="h-1 w-12 overflow-hidden rounded-full bg-red-500/30">
                              <div className="h-full rounded-full bg-green-500/70" style={{ width: `${buyPct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Trade rows */}
                  <div className="max-h-[420px] overflow-auto">
                    {tradesLoading && !tradesData?.trades?.length && (
                      <div className="space-y-1 p-3">
                        {[1,2,3,4,5].map(i => (
                          <div key={i} className="animate-pulse h-9 rounded-lg bg-white/[0.03]" />
                        ))}
                      </div>
                    )}

                    {!tradesLoading && !tradesData?.trades?.length && (
                      <div className="flex h-40 items-center justify-center text-sm text-zinc-500">
                        No trades found yet.
                      </div>
                    )}

                    {tradesData?.trades?.length ? (
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-zinc-950">
                          <tr className="text-left text-zinc-500 border-b border-white/5">
                            <th className="px-4 py-2 font-medium">Type</th>
                            <th className="px-4 py-2 font-medium">Amount</th>
                            <th className="px-4 py-2 font-medium">SOL</th>
                            <th className="px-4 py-2 font-medium">Wallet</th>
                            <th className="px-4 py-2 font-medium text-right">Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tradesData.trades.map((t) => {
                            const isNew = newTradeKeys.has(t.signature);
                            const isBuy = t.type === "buy";
                            const timeAgo = (() => {
                              const secs = Math.floor(Date.now() / 1000) - t.blockTime;
                              if (secs < 60) return `${secs}s`;
                              if (secs < 3600) return `${Math.floor(secs / 60)}m`;
                              if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
                              return `${Math.floor(secs / 86400)}d`;
                            })();

                            const fmtTokenAmt = (n: number) => {
                              if (n >= 1_000_000) return `${(n/1_000_000).toFixed(2)}M`;
                              if (n >= 1_000) return `${(n/1_000).toFixed(2)}K`;
                              return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
                            };

                            return (
                              <tr
                                key={t.signature}
                                className={[
                                  "border-b border-white/[0.04] transition-colors duration-700",
                                  isNew
                                    ? isBuy ? "bg-green-500/10" : "bg-red-500/10"
                                    : "hover:bg-white/[0.02]"
                                ].join(" ")}
                              >
                                <td className="px-4 py-2">
                                  <span className={["font-semibold", isBuy ? "text-green-400" : "text-red-400"].join(" ")}>
                                    {isBuy ? "BUY" : "SELL"}
                                  </span>
                                  {t.source && (
                                    <span className="ml-1.5 text-zinc-600">{t.source.toLowerCase()}</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 font-mono text-zinc-200">
                                  {fmtTokenAmt(t.tokenAmount)}
                                  <span className="ml-1 text-zinc-500">{tradesData.baseSymbol ?? ""}</span>
                                </td>
                                <td className="px-4 py-2 font-mono text-zinc-300">
                                  {t.solAmount !== null ? `◎${t.solAmount.toFixed(4)}` : "—"}
                                </td>
                                <td className="px-4 py-2">
                                  <a
                                    href={`/user/${encodeURIComponent(t.walletAddress)}`}
                                    className="font-mono text-zinc-400 hover:text-white transition"
                                  >
                                    {shortAddr(t.walletAddress)}
                                  </a>
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-zinc-500">
                                  <a
                                    href={`https://solscan.io/tx/${t.signature}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="hover:text-zinc-300 transition"
                                    title={t.signature}
                                  >
                                    {timeAgo} ↗
                                  </a>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : null}
                  </div>
                </div>
              )}

              {/* ── HOLDERS TAB ─────────────────────────────────────────────── */}
              {bottomTab === "holders" && (
                <div className="p-4">
                  {/* Summary row */}
                  {holdersData && (
                    <div className="mb-4 flex flex-wrap gap-4 text-xs text-zinc-400">
                      <span>
                        Total supply:{" "}
                        <span className="text-zinc-200 font-semibold">
                          {holdersData.totalSupply >= 1_000_000_000
                            ? `${(holdersData.totalSupply / 1_000_000_000).toFixed(2)}B`
                            : holdersData.totalSupply >= 1_000_000
                            ? `${(holdersData.totalSupply / 1_000_000).toFixed(2)}M`
                            : holdersData.totalSupply.toLocaleString()}
                        </span>
                      </span>
                      {holdersData.holderCount > 0 && (
                        <span>
                          Total holders:{" "}
                          <span className="text-zinc-200 font-semibold">
                            {holdersData.holderCount.toLocaleString()}
                          </span>
                        </span>
                      )}
                      <span className="text-zinc-600">Showing top {holdersData.holders.length}</span>
                    </div>
                  )}

                  {/* Loading */}
                  {holdersLoading && (
                    <div className="space-y-2">
                      {[1,2,3,4,5,6,7,8].map(i => (
                        <div key={i} className="animate-pulse h-10 rounded-xl bg-white/[0.03]" />
                      ))}
                    </div>
                  )}

                  {/* Error */}
                  {holdersErr && !holdersLoading && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
                      {holdersErr}
                    </div>
                  )}

                  {/* Holder rows */}
                  {!holdersLoading && !holdersErr && holdersData && (
                    holdersData.holders.length === 0 ? (
                      <div className="flex h-32 items-center justify-center text-sm text-zinc-500">
                        No holders found.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {holdersData.holders.map((h, i) => (
                          <div
                            key={h.address}
                            className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2.5"
                          >
                            {/* Rank */}
                            <span className="w-5 shrink-0 text-xs text-zinc-600 font-mono text-right">
                              {i + 1}
                            </span>

                            {/* Wallet — link to /user/[wallet] */}
                            <a
                              href={`/user/${encodeURIComponent(h.owner)}`}
                              className="min-w-0 flex-1 font-mono text-xs text-zinc-300 hover:text-white transition truncate"
                              title={h.owner}
                            >
                              {h.owner.slice(0, 4)}…{h.owner.slice(-4)}
                            </a>

                            {/* Amount */}
                            <span className="shrink-0 text-xs text-zinc-400 tabular-nums">
                              {h.amount >= 1_000_000_000
                                ? `${(h.amount / 1_000_000_000).toFixed(2)}B`
                                : h.amount >= 1_000_000
                                ? `${(h.amount / 1_000_000).toFixed(2)}M`
                                : h.amount >= 1_000
                                ? `${(h.amount / 1_000).toFixed(2)}K`
                                : h.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </span>

                            {/* Percentage + bar */}
                            <div className="flex w-24 shrink-0 items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full bg-emerald-500/70"
                                  style={{ width: `${Math.min(h.pct, 100)}%` }}
                                />
                              </div>
                              <span className={[
                                "w-12 text-right text-xs font-semibold tabular-nums",
                                h.pct >= 10 ? "text-amber-400" : "text-zinc-300"
                              ].join(" ")}>
                                {h.pct.toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )}

                  {/* Refresh button */}
                  {!holdersLoading && holdersData && (
                    <button
                      onClick={() => coin && loadHolders(coin.token_address)}
                      className="mt-4 text-xs text-zinc-600 hover:text-zinc-400 transition"
                    >
                      ↻ Refresh
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Community</h2>
                  <p className="mt-1 text-sm text-zinc-400">Private group chat for this coin (join to view messages).</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {commLoading ? (
                    <span className="text-xs text-zinc-400">Loading…</span>
                  ) : community ? (
                    <>
                      {viewerIsMember ? (
                        <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300">
                          You’re a member
                        </span>
                      ) : (
                        <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300">
                          Not joined
                        </span>
                      )}

                      <Link
                        href={`/community/${encodeURIComponent(community.id)}`}
                        className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-zinc-200"
                      >
                        Open community →
                      </Link>
                    </>
                  ) : viewerIsDevOwner ? (
                    <button
                      onClick={createCommunity}
                      disabled={createBusy}
                      className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                    >
                      {createBusy ? "Creating…" : "Create community"}
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-500">No community yet.</span>
                  )}
                </div>
              </div>

              {commErr ? <div className="mt-3 text-sm text-red-300">{commErr}</div> : null}
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Comments</h2>
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
                    {comments.map((cm) => {
                      const name = (cm.author_name || "").trim() || shortAddr(cm.author_wallet);
                      return (
                        <div key={cm.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-white/10 bg-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {cm.author_pfp_url ? (
                                  <img src={cm.author_pfp_url} alt="" className="h-full w-full object-cover" />
                                ) : null}
                              </div>

                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                  <a
                                    href={cm.is_dev ? `/dev/${encodeURIComponent(cm.author_wallet)}` : `/user/${encodeURIComponent(cm.author_wallet)}`}
                                    className="truncate text-sm font-semibold hover:underline"
                                  >
                                    {name}
                                  </a>
                                  {cm.is_dev ? (
                                    <span className="shrink-0 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-200">
                                      DEV
                                    </span>
                                  ) : null}
                                </div>
                                <a
                                  href={cm.is_dev ? `/dev/${encodeURIComponent(cm.author_wallet)}` : `/user/${encodeURIComponent(cm.author_wallet)}`}
                                  className="font-mono text-[11px] text-zinc-500 hover:text-zinc-300"
                                >
                                  {shortAddr(cm.author_wallet)}
                                </a>
                              </div>
                            </div>

                            <div className="shrink-0 text-[11px] text-zinc-500">
                              {new Date(cm.created_at).toLocaleString()}
                            </div>
                          </div>

                          <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">{cm.comment}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Trial upgrade modal */}
      <UpgradeModal
        open={trialToast}
        onClose={() => setTrialToast(false)}
      />
    </main>
  );
}

// ─── CandlestickChart ─────────────────────────────────────────────────────────
// Pure canvas candlestick chart — no external charting library needed.

type CandlestickChartProps = {
  candles: Candle[];
  baseSymbol: string | null;
  quoteSymbol: string | null;
};

function CandlestickChart({ candles, baseSymbol, quoteSymbol }: CandlestickChartProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = React.useState<{
    x: number; y: number;
    candle: Candle;
  } | null>(null);

  // Memoize derived layout so we can use it in both draw + mousemove
  const layout = React.useMemo(() => {
    if (!candles.length) return null;

    const H = 320;
    const PADDING_LEFT   = 12;
    const PADDING_RIGHT  = 60; // price axis
    const PADDING_TOP    = 12;
    const PADDING_BOTTOM = 28; // time axis

    const prices = candles.flatMap((c) => [c.high, c.low]);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const priceRange = maxP - minP || maxP * 0.01 || 1;
    const paddedMin = minP - priceRange * 0.05;
    const paddedMax = maxP + priceRange * 0.05;
    const paddedRange = paddedMax - paddedMin;

    const volumes = candles.map((c) => c.volume);
    const maxVol = Math.max(...volumes) || 1;

    return {
      H, PADDING_LEFT, PADDING_RIGHT, PADDING_TOP, PADDING_BOTTOM,
      paddedMin, paddedMax, paddedRange, maxVol, candles
    };
  }, [candles]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth;
    const { H, PADDING_LEFT, PADDING_RIGHT, PADDING_TOP, PADDING_BOTTOM,
            paddedMin, paddedRange, maxVol, candles } = layout;

    canvas.width  = W * dpr;
    canvas.height = H * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, W, H);

    const chartW = W - PADDING_LEFT - PADDING_RIGHT;
    const chartH = H - PADDING_TOP  - PADDING_BOTTOM;
    const volH   = Math.floor(chartH * 0.15); // volume bar area at bottom

    const priceH = chartH - volH - 4;

    const n = candles.length;
    const candleW = Math.max(1, chartW / n);
    const bodyW   = Math.max(1, candleW * 0.6);

    function priceToY(p: number) {
      return PADDING_TOP + priceH - ((p - paddedMin) / paddedRange) * priceH;
    }

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = PADDING_TOP + (priceH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(PADDING_LEFT, y);
      ctx.lineTo(W - PADDING_RIGHT, y);
      ctx.stroke();
    }

    // Price axis labels
    ctx.fillStyle = "#52525b";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    for (let i = 0; i <= gridLines; i++) {
      const p = paddedMin + paddedRange * (1 - i / gridLines);
      const y = PADDING_TOP + (priceH / gridLines) * i;
      const label = p < 0.0001 ? p.toExponential(2) : p < 1 ? p.toPrecision(4) : p.toFixed(2);
      ctx.fillText("$" + label, W - PADDING_RIGHT + 4, y + 3);
    }

    // Time axis labels (sample ~5 evenly spaced)
    const timeStep = Math.floor(n / 5) || 1;
    ctx.textAlign = "center";
    for (let i = 0; i < n; i += timeStep) {
      const x = PADDING_LEFT + (i + 0.5) * candleW;
      const d = new Date(candles[i].time * 1000);
      const label = d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
      ctx.fillText(label, x, H - 6);
    }

    // Candles
    for (let i = 0; i < n; i++) {
      const c   = candles[i];
      const x   = PADDING_LEFT + i * candleW;
      const cx  = x + candleW / 2;

      const isBull = c.close >= c.open;
      const color  = isBull ? "#22c55e" : "#ef4444";

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, priceToY(c.high));
      ctx.lineTo(cx, priceToY(c.low));
      ctx.stroke();

      // Body
      const yOpen  = priceToY(c.open);
      const yClose = priceToY(c.close);
      const bodyY  = Math.min(yOpen, yClose);
      const bodyH  = Math.max(1, Math.abs(yOpen - yClose));

      ctx.fillStyle = color;
      ctx.fillRect(cx - bodyW / 2, bodyY, bodyW, bodyH);

      // Volume bar
      const volBarH  = (c.volume / maxVol) * volH;
      const volBarY  = H - PADDING_BOTTOM - volBarH;
      ctx.fillStyle  = isBull ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)";
      ctx.fillRect(cx - bodyW / 2, volBarY, bodyW, volBarH);
    }
  }, [layout]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !layout) { setTooltip(null); return; }

    const rect = canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;

    const { PADDING_LEFT, PADDING_RIGHT, candles } = layout;
    const chartW  = canvas.offsetWidth - PADDING_LEFT - PADDING_RIGHT;
    const candleW = chartW / candles.length;
    const idx     = Math.floor((mx - PADDING_LEFT) / candleW);

    if (idx < 0 || idx >= candles.length) { setTooltip(null); return; }
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, candle: candles[idx] });
  }

  // Format price for tooltip
  function fmtP(n: number) {
    if (n < 0.0001) return n.toExponential(4);
    if (n < 1) return n.toPrecision(5);
    return n.toFixed(4);
  }

  return (
    <div className="relative w-full select-none">
      <div className="mb-1 text-[11px] text-zinc-600">
        {baseSymbol && quoteSymbol ? `${baseSymbol} / ${quoteSymbol}` : baseSymbol ?? ""}
      </div>
      <canvas
        ref={canvasRef}
        className="h-[320px] w-full cursor-crosshair rounded-xl"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
        style={{ display: "block" }}
      />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-xl border border-white/10 bg-zinc-900/95 p-2.5 text-xs shadow-xl backdrop-blur"
          style={{
            left: tooltip.x > 200 ? tooltip.x - 160 : tooltip.x + 12,
            top:  Math.max(0, tooltip.y - 80)
          }}
        >
          <div className="mb-1 text-zinc-400">{new Date(tooltip.candle.time * 1000).toLocaleString()}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <span className="text-zinc-500">O</span><span className="font-mono text-white">${fmtP(tooltip.candle.open)}</span>
            <span className="text-zinc-500">H</span><span className="font-mono text-green-400">${fmtP(tooltip.candle.high)}</span>
            <span className="text-zinc-500">L</span><span className="font-mono text-red-400">${fmtP(tooltip.candle.low)}</span>
            <span className="text-zinc-500">C</span><span className="font-mono text-white">${fmtP(tooltip.candle.close)}</span>
            <span className="text-zinc-500">Vol</span>
            <span className="font-mono text-zinc-300">
              {tooltip.candle.volume >= 1_000_000
                ? `${(tooltip.candle.volume/1_000_000).toFixed(2)}M`
                : tooltip.candle.volume >= 1_000
                ? `${(tooltip.candle.volume/1_000).toFixed(1)}K`
                : tooltip.candle.volume.toFixed(0)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
