"use client";

import React, { useEffect, useMemo, useState } from "react";
import TopNav from "@/components/TopNav";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

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

type Profile = {
  wallet: string;
  display_name: string;
  bio: string | null;
  pfp_url: string | null; // legacy (unused)
  pfp_path?: string | null; // new
  x_url: string | null;
};

type Coin = {
  id: string;
  token_address: string;
  title: string | null;
  description: string | null;
  created_at: string;
};

type Post = {
  id: string;
  content: string;
  created_at: string;

  image_url?: string | null;
  image_path?: string | null;

  poll?: Poll | null;
};

type LiveMeta = {
  ok: true;
  mint: string;
  name: string | null;
  symbol: string | null;
  image: string | null;
};

type Community = {
  id: string;
  coin_id: string;
  dev_wallet: string;
  title: string | null;
  created_at: string;
};

type CommunityGet = {
  ok: true;
  community: Community | null;
  viewerIsMember: boolean;
};

type GoldenHourStatus = {
  ok: true;
  targetDate: string;
  schedule: {
    optInOpensAt: string;
    revealAt: string;
    startsAt: string;
    endsAt: string;
  };
  eligibility: {
    isEligible: boolean;
    minRating: number;
    avgRating: number | null;
    reviewCount: number;
  };
  ui: {
    optInOpen: boolean;
    revealLive: boolean;
    winnerChosen: boolean;
    activeNow: boolean;
    hasEntered: boolean;
    iWon: boolean;
    iLost: boolean;
    state: "not_eligible" | "can_enter" | "opted_in" | "won" | "lost" | "closed";
  };
  entry: {
    id: string;
    target_date: string;
    dev_wallet: string;
    coin_id: string;
    banner_path: string;
    coin_title: string | null;
    token_address: string | null;
    created_at: string;
    updated_at: string;
  } | null;
  winner: {
    id: string;
    target_date: string;
    entry_id: string;
    dev_wallet: string;
    coin_id: string;
    banner_path: string;
    opt_in_opens_at: string;
    reveal_at: string;
    starts_at: string;
    ends_at: string;
    created_at: string;
  } | null;
  ownedCoins: Array<{
    id: string;
    wallet: string;
    token_address: string;
    title: string | null;
    description: string | null;
    created_at: string;
  }>;
};

type BiddingAdStatus = {
  ok: true;
  targetDate: string;
  schedule: {
    entryOpensAt: string;
    auctionStartsAt: string;
    auctionEndsAt: string;
  };
  pricing: {
    entryFeeSol: number;
    entryFeeLamports: number;
  };
  eligibility: {
    isEligible: boolean;
    avgRating: number | null;
    reviewCount: number;
  };
  ui: {
    entryOpen: boolean;
    auctionLive: boolean;
    auctionClosed: boolean;
    hasEntered: boolean;
    iWon: boolean;
    state: "can_enter" | "entered" | "auction_live" | "won" | "lost" | "closed";
  };
  auction: {
    id: string;
    target_date: string;
    entry_opens_at: string;
    auction_starts_at: string;
    auction_ends_at: string;
    status: "scheduled" | "live" | "awaiting_payment" | "completed" | "rolled_over" | "cancelled";
    highest_bid_lamports: number | null;
    highest_bidder_wallet: string | null;
    highest_bid_entry_id: string | null;
    last_bid_at: string | null;
    bid_count: number;
    created_at: string;
    updated_at: string;
  };
  entry: {
    id: string;
    auction_id: string;
    target_date: string;
    dev_wallet: string;
    coin_id: string;
    banner_path: string;
    coin_title: string | null;
    token_address: string | null;
    entry_fee_lamports: number;
    entry_payment_status: "pending" | "paid" | "failed" | "refunded";
    created_at: string;
    updated_at: string;
  } | null;
  winner: {
    id: string;
    auction_id: string;
    target_date: string;
    entry_id: string;
    bid_id: string;
    dev_wallet: string;
    coin_id: string;
    banner_path: string;
    amount_lamports: number;
    ad_starts_at: string;
    ad_ends_at: string;
    payment_confirmed_at: string | null;
    created_at: string;
  } | null;
  ownedCoins: Array<{
    id: string;
    wallet: string;
    token_address: string;
    title: string | null;
    description: string | null;
    created_at: string;
  }>;
};

const BANNER_MAX_BYTES = 15 * 1024 * 1024;
const BANNER_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const BANNER_RECOMMENDED = "1500×500 (3:1)";

const COIN_BANNER_MAX_BYTES = 15 * 1024 * 1024;
const COIN_BANNER_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const COIN_BANNER_RECOMMENDED = "1500×500 (3:1)";

const GOLDEN_HOUR_BANNER_MAX_BYTES = 15 * 1024 * 1024;
const GOLDEN_HOUR_BANNER_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const GOLDEN_HOUR_BANNER_RECOMMENDED = "1500×500 (3:1)";

const BIDDING_AD_BANNER_MAX_BYTES = 15 * 1024 * 1024;
const BIDDING_AD_BANNER_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const BIDDING_AD_BANNER_RECOMMENDED = "1500×500 (3:1)";

export default function DevProfilePage() {
  const { publicKey, connected, sendTransaction } = useWallet();

  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    "https://api.mainnet-beta.solana.com";

  const treasuryWallet = process.env.NEXT_PUBLIC_TREASURY_WALLET || "";

  const connection = useMemo(() => new Connection(rpcUrl, "confirmed"), [rpcUrl]);

  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [xUrl, setXUrl] = useState("");

  const [postContent, setPostContent] = useState("");
  const [postFile, setPostFile] = useState<File | null>(null);
  const [postBusy, setPostBusy] = useState(false);

  const [postPollQuestion, setPostPollQuestion] = useState("");
  const [postPollOptions, setPostPollOptions] = useState<string[]>(["", ""]);
  const [postPollBusy, setPostPollBusy] = useState(false);

  const [coinAddr, setCoinAddr] = useState("");
  const [coinTitle, setCoinTitle] = useState("");
  const [coinDesc, setCoinDesc] = useState("");

  const [coinBannerFile, setCoinBannerFile] = useState<File | null>(null);
  const [coinBannerErr, setCoinBannerErr] = useState<string | null>(null);

  const [pfpSignedUrl, setPfpSignedUrl] = useState<string | null>(null);

  const [pfpFile, setPfpFile] = useState<File | null>(null);
  const [pfpUploading, setPfpUploading] = useState(false);

  const [bannerSignedUrl, setBannerSignedUrl] = useState<string | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerErr, setBannerErr] = useState<string | null>(null);

  const [goldenHour, setGoldenHour] = useState<GoldenHourStatus | null>(null);
  const [goldenHourLoading, setGoldenHourLoading] = useState(false);
  const [goldenHourErr, setGoldenHourErr] = useState<string | null>(null);
  const [goldenHourEntryOpen, setGoldenHourEntryOpen] = useState(false);

  const [goldenHourCoinId, setGoldenHourCoinId] = useState<string>("");
  const [goldenHourBannerFile, setGoldenHourBannerFile] = useState<File | null>(null);
  const [goldenHourBannerErr, setGoldenHourBannerErr] = useState<string | null>(null);
  const [goldenHourSubmitBusy, setGoldenHourSubmitBusy] = useState(false);
  const [goldenHourDeleteBusy, setGoldenHourDeleteBusy] = useState(false);

  const [biddingAd, setBiddingAd] = useState<BiddingAdStatus | null>(null);
  const [biddingAdLoading, setBiddingAdLoading] = useState(false);
  const [biddingAdErr, setBiddingAdErr] = useState<string | null>(null);
  const [biddingAdEntryOpen, setBiddingAdEntryOpen] = useState(false);

  const [biddingAdCoinId, setBiddingAdCoinId] = useState<string>("");
  const [biddingAdBannerFile, setBiddingAdBannerFile] = useState<File | null>(null);
  const [biddingAdBannerErr, setBiddingAdBannerErr] = useState<string | null>(null);
  const [biddingAdSubmitBusy, setBiddingAdSubmitBusy] = useState(false);
  const [biddingAdDeleteBusy, setBiddingAdDeleteBusy] = useState(false);
  const [biddingAdPayBusy, setBiddingAdPayBusy] = useState(false);

  const [metaByMint, setMetaByMint] = useState<Record<string, LiveMeta | null>>({});
  const [metaLoadingMints, setMetaLoadingMints] = useState<Record<string, boolean>>({});

  const [communityByCoinId, setCommunityByCoinId] = useState<Record<string, Community | null>>({});
  const [communityLoadingByCoinId, setCommunityLoadingByCoinId] = useState<Record<string, boolean>>({});
  const [communityCreatingByCoinId, setCommunityCreatingByCoinId] = useState<Record<string, boolean>>({});

  async function refreshGoldenHour() {
    setGoldenHourLoading(true);
    setGoldenHourErr(null);
    try {
      const res = await fetch("/api/dev/golden-hour", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setGoldenHour(null);
        setGoldenHourErr(json?.error ?? "Failed to load Golden Hour");
        return;
      }
      setGoldenHour(json as GoldenHourStatus);
    } catch (e: any) {
      setGoldenHour(null);
      setGoldenHourErr(e?.message ?? "Failed to load Golden Hour");
    } finally {
      setGoldenHourLoading(false);
    }
  }

  async function refreshBiddingAd() {
    setBiddingAdLoading(true);
    setBiddingAdErr(null);
    try {
      const res = await fetch("/api/dev/bidding-ad", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setBiddingAd(null);
        setBiddingAdErr(json?.error ?? "Failed to load Bidding Ad");
        return;
      }
      setBiddingAd(json as BiddingAdStatus);
    } catch (e: any) {
      setBiddingAd(null);
      setBiddingAdErr(e?.message ?? "Failed to load Bidding Ad");
    } finally {
      setBiddingAdLoading(false);
    }
  }

  async function refresh() {
    setLoading(true);
    const res = await fetch("/api/dev/profile", { cache: "no-store" });
    const data = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      alert(data?.error ?? "Failed to load dev profile");
      return;
    }

    setProfile(data.profile);
    setCoins(data.coins ?? []);
    setPosts((data.posts ?? []) as Post[]);

    if (data.profile) {
      setDisplayName(data.profile.display_name ?? "");
      setBio(data.profile.bio ?? "");
      setXUrl(data.profile.x_url ?? "");
    }

    const w = data?.profile?.wallet;
    if (w) {
      const p = await fetch(`/api/public/pfp?wallet=${encodeURIComponent(w)}`, { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null);
      setPfpSignedUrl(p?.url ?? null);

      const b = await fetch(`/api/public/banner?wallet=${encodeURIComponent(w)}`, { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null);
      setBannerSignedUrl(b?.url ?? null);
    } else {
      setPfpSignedUrl(null);
      setBannerSignedUrl(null);
    }
  }

  useEffect(() => {
    refresh();
    refreshGoldenHour();
    refreshBiddingAd();
  }, []);

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

      setMetaByMint((prev) => ({ ...prev, [m]: json as LiveMeta }));
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
    if (!coins?.length) return;
    const visible = coins.slice(0, 50).map((c) => c.token_address);
    fetchCoinMetaBatched(visible, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coins]);

  async function fetchCommunityForCoin(coinId: string) {
    const id = (coinId || "").trim();
    if (!id) return;
    if (Object.prototype.hasOwnProperty.call(communityByCoinId, id)) return;

    setCommunityLoadingByCoinId((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/coin/${encodeURIComponent(id)}/community`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as CommunityGet | null;

      if (!res.ok) {
        setCommunityByCoinId((prev) => ({ ...prev, [id]: null }));
        return;
      }

      setCommunityByCoinId((prev) => ({ ...prev, [id]: json?.community ?? null }));
    } finally {
      setCommunityLoadingByCoinId((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function fetchCommunityBatched(coinIds: string[], batchSize = 6) {
    const uniq = Array.from(new Set(coinIds.filter(Boolean).map((x) => x.trim())));
    const need = uniq.filter((id) => !Object.prototype.hasOwnProperty.call(communityByCoinId, id));
    if (need.length === 0) return;

    for (let i = 0; i < need.length; i += batchSize) {
      const chunk = need.slice(i, i + batchSize);
      await Promise.allSettled(chunk.map((id) => fetchCommunityForCoin(id)));
    }
  }

  useEffect(() => {
    if (!coins?.length) return;
    const visibleIds = coins.slice(0, 50).map((c) => c.id);
    fetchCommunityBatched(visibleIds, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coins]);

  async function createCommunity(coin: Coin, defaultTitle: string) {
    if (!coin?.id) return;

    const coinId = coin.id;
    setCommunityCreatingByCoinId((prev) => ({ ...prev, [coinId]: true }));
    try {
      const res = await fetch(`/api/coin/${encodeURIComponent(coinId)}/community`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: defaultTitle || null })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json?.error ?? "Failed to create community");
        return;
      }

      const created: Community | null = json?.community ?? null;
      setCommunityByCoinId((prev) => ({ ...prev, [coinId]: created }));
    } finally {
      setCommunityCreatingByCoinId((prev) => ({ ...prev, [coinId]: false }));
    }
  }

  async function saveProfile() {
    const res = await fetch("/api/dev/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: displayName,
        bio,
        x_url: xUrl || null
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data?.error ?? "Save failed");

    await refresh();
  }

  async function uploadPfp() {
    if (!pfpFile) return;
    setPfpUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", pfpFile);

      const res = await fetch("/api/dev/pfp", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json?.error ?? "Upload failed");
        return;
      }

      setPfpFile(null);
      await refresh();
    } finally {
      setPfpUploading(false);
    }
  }

  async function uploadBanner() {
    if (!bannerFile) return;

    setBannerErr(null);

    if (!BANNER_ALLOWED.has(bannerFile.type)) {
      setBannerErr("Invalid file type. Allowed: JPG, PNG, WEBP.");
      return;
    }

    if (bannerFile.size <= 0) {
      setBannerErr("Empty file.");
      return;
    }

    if (bannerFile.size > BANNER_MAX_BYTES) {
      setBannerErr("File too large (max 15MB).");
      return;
    }

    setBannerUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", bannerFile);

      const res = await fetch("/api/dev/banner", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBannerErr(json?.error ?? "Banner upload failed");
        return;
      }

      setBannerFile(null);
      await refresh();
    } finally {
      setBannerUploading(false);
    }
  }

  async function createPost() {
    const content = postContent.trim();

    const q = postPollQuestion.trim();
    const opts = postPollOptions.map((x) => x.trim()).filter(Boolean);

    const pollStarted = q.length > 0 || opts.length > 0;
    const pollValid = q.length >= 2 && opts.length >= 2;

    if (pollStarted && !pollValid) {
      if (q.length < 2) return alert("Poll question is too short.");
      if (opts.length < 2) return alert("Poll needs at least 2 options.");
    }

    const hasSomething = content.length >= 2 || !!postFile || pollValid;
    if (!hasSomething) return alert("Add text, an image, or a poll with 2+ options.");

    setPostBusy(true);
    try {
      const fd = new FormData();
      if (content.length >= 2) fd.append("content", content);
      if (postFile) fd.append("file", postFile);

      if (pollValid) {
        fd.append("poll_question", q);
        fd.append("poll_options", JSON.stringify(opts));
      }

      const res = await fetch("/api/dev/posts", {
        method: "POST",
        body: fd
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data?.error ?? "Post failed");

      setPostContent("");
      setPostFile(null);
      setPostPollQuestion("");
      setPostPollOptions(["", ""]);

      await refresh();
    } finally {
      setPostBusy(false);
    }
  }

  async function voteDevPostPoll(pollId: string, optionId: string) {
    try {
      const res = await fetch(`/api/dev/posts/polls/${encodeURIComponent(pollId)}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option_id: optionId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data?.error ?? "Vote failed");

      await refresh();
    } catch (e: any) {
      alert(e?.message ?? "Vote failed");
    }
  }

  function PollCard({ poll }: { poll: Poll }) {
    const total = (poll.options ?? []).reduce((sum, o) => sum + (Number(o.votes) || 0), 0);

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
                onClick={() => voteDevPostPoll(poll.id, o.id)}
                className={[
                  "w-full overflow-hidden rounded-xl border border-white/10 p-2 text-left",
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
          {total} total vote{total === 1 ? "" : "s"}
        </div>
      </div>
    );
  }

  async function addCoin() {
    setCoinBannerErr(null);

    if (coinBannerFile) {
      if (!COIN_BANNER_ALLOWED.has(coinBannerFile.type)) {
        setCoinBannerErr("Invalid banner type. Allowed: JPG, PNG, WEBP.");
        return;
      }
      if (coinBannerFile.size <= 0) {
        setCoinBannerErr("Empty banner file.");
        return;
      }
      if (coinBannerFile.size > COIN_BANNER_MAX_BYTES) {
        setCoinBannerErr("Banner too large (max 15MB).");
        return;
      }
    }

    const fd = new FormData();
    fd.append("token_address", coinAddr);
    fd.append("title", coinTitle || "");
    fd.append("description", coinDesc || "");
    if (coinBannerFile) fd.append("file", coinBannerFile);

    const res = await fetch("/api/dev/coins", {
      method: "POST",
      body: fd
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data?.error ?? "Add coin failed");

    setCoinAddr("");
    setCoinTitle("");
    setCoinDesc("");
    setCoinBannerFile(null);
    setCoinBannerErr(null);
    await refresh();
    await refreshGoldenHour();
    await refreshBiddingAd();
  }

  async function submitGoldenHourEntry() {
    setGoldenHourBannerErr(null);

    if (!goldenHourCoinId) {
      setGoldenHourBannerErr("Choose one of your coins.");
      return;
    }

    if (!goldenHourBannerFile) {
      setGoldenHourBannerErr("Choose a banner.");
      return;
    }

    if (!GOLDEN_HOUR_BANNER_ALLOWED.has(goldenHourBannerFile.type)) {
      setGoldenHourBannerErr("Invalid banner type. Allowed: JPG, PNG, WEBP.");
      return;
    }

    if (goldenHourBannerFile.size <= 0) {
      setGoldenHourBannerErr("Empty banner file.");
      return;
    }

    if (goldenHourBannerFile.size > GOLDEN_HOUR_BANNER_MAX_BYTES) {
      setGoldenHourBannerErr("Banner too large (max 15MB).");
      return;
    }

    setGoldenHourSubmitBusy(true);
    try {
      const fd = new FormData();
      fd.append("coin_id", goldenHourCoinId);
      fd.append("file", goldenHourBannerFile);

      const res = await fetch("/api/dev/golden-hour", {
        method: "POST",
        body: fd
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGoldenHourBannerErr(json?.error ?? "Failed to save Golden Hour entry");
        return;
      }

      setGoldenHourEntryOpen(false);
      setGoldenHourBannerFile(null);
      setGoldenHourBannerErr(null);
      await refreshGoldenHour();
    } finally {
      setGoldenHourSubmitBusy(false);
    }
  }

  async function removeGoldenHourEntry() {
    const ok = confirm("Remove your Golden Hour entry?");
    if (!ok) return;

    setGoldenHourDeleteBusy(true);
    try {
      const res = await fetch("/api/dev/golden-hour", {
        method: "DELETE"
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json?.error ?? "Failed to remove Golden Hour entry");
        return;
      }

      setGoldenHourCoinId("");
      setGoldenHourBannerFile(null);
      setGoldenHourBannerErr(null);
      await refreshGoldenHour();
    } finally {
      setGoldenHourDeleteBusy(false);
    }
  }

  async function payBiddingAdEntryFee(statusArg?: BiddingAdStatus | null) {
    const currentStatus = statusArg ?? biddingAd;

    if (!currentStatus?.entry) {
      throw new Error("No bidding ad entry found to pay for.");
    }

    if (currentStatus.entry.entry_payment_status === "paid") {
      await refreshBiddingAd();
      return;
    }

    if (!connected || !publicKey) {
      throw new Error("Connect the wallet you use for this dev profile first.");
    }

    if (!sendTransaction) {
      throw new Error("Wallet does not support sending transactions.");
    }

    if (!treasuryWallet) {
      throw new Error("Treasury wallet is not configured.");
    }

    const lamports = Number(currentStatus.pricing?.entryFeeLamports ?? 0);
    if (!Number.isFinite(lamports) || lamports <= 0) {
      throw new Error("Invalid entry fee amount.");
    }

    setBiddingAdPayBusy(true);
    try {
      const treasuryPubkey = new PublicKey(treasuryWallet);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

      const tx = new Transaction({
        feePayer: publicKey,
        recentBlockhash: blockhash
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: treasuryPubkey,
          lamports
        })
      );

      const signature = await sendTransaction(tx, connection, {
        skipPreflight: false,
        preflightCommitment: "confirmed"
      });

      await connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight
        },
        "confirmed"
      );

      const confirmRes = await fetch("/api/payments/confirm-bidding-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature,
          target_date: currentStatus.targetDate
        })
      });

      const confirmJson = await confirmRes.json().catch(() => ({}));
      if (!confirmRes.ok) {
        throw new Error(confirmJson?.error ?? "Entry payment confirmation failed");
      }

      await refreshBiddingAd();
    } finally {
      setBiddingAdPayBusy(false);
    }
  }

  async function submitBiddingAdEntry() {
    setBiddingAdBannerErr(null);

    if (!biddingAdCoinId) {
      setBiddingAdBannerErr("Choose one of your coins.");
      return;
    }

    const hasExistingBanner = !!biddingAd?.entry?.banner_path;

    if (!biddingAdBannerFile && !hasExistingBanner) {
      setBiddingAdBannerErr("Choose a banner.");
      return;
    }

    if (biddingAdBannerFile) {
      if (!BIDDING_AD_BANNER_ALLOWED.has(biddingAdBannerFile.type)) {
        setBiddingAdBannerErr("Invalid banner type. Allowed: JPG, PNG, WEBP.");
        return;
      }

      if (biddingAdBannerFile.size <= 0) {
        setBiddingAdBannerErr("Empty banner file.");
        return;
      }

      if (biddingAdBannerFile.size > BIDDING_AD_BANNER_MAX_BYTES) {
        setBiddingAdBannerErr("Banner too large (max 15MB).");
        return;
      }
    }

    setBiddingAdSubmitBusy(true);
    try {
      const fd = new FormData();
      fd.append("coin_id", biddingAdCoinId);
      if (biddingAdBannerFile) fd.append("file", biddingAdBannerFile);

      const res = await fetch("/api/dev/bidding-ad", {
        method: "POST",
        body: fd
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBiddingAdBannerErr(json?.error ?? "Failed to save bidding ad entry");
        return;
      }

      const savedStatus = json as BiddingAdStatus;
      setBiddingAd(savedStatus);

      if (savedStatus.entry?.entry_payment_status !== "paid") {
        try {
          await payBiddingAdEntryFee(savedStatus);
        } catch (e: any) {
          setBiddingAdBannerErr(e?.message ?? "Entry saved, but payment failed");
          await refreshBiddingAd();
          return;
        }
      } else {
        await refreshBiddingAd();
      }

      setBiddingAdEntryOpen(false);
      setBiddingAdBannerFile(null);
      setBiddingAdBannerErr(null);
    } finally {
      setBiddingAdSubmitBusy(false);
    }
  }

  async function removeBiddingAdEntry() {
    const ok = confirm("Remove your bidding ad entry?");
    if (!ok) return;

    setBiddingAdDeleteBusy(true);
    try {
      const res = await fetch("/api/dev/bidding-ad", {
        method: "DELETE"
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json?.error ?? "Failed to remove bidding ad entry");
        return;
      }

      setBiddingAdCoinId("");
      setBiddingAdBannerFile(null);
      setBiddingAdBannerErr(null);
      await refreshBiddingAd();
    } finally {
      setBiddingAdDeleteBusy(false);
    }
  }

  async function resumeBiddingAdPayment() {
    try {
      await payBiddingAdEntryFee();
      alert("Entry fee paid successfully.");
    } catch (e: any) {
      alert(e?.message ?? "Failed to pay entry fee");
    }
  }

  async function deleteProfile() {
    const ok = confirm("Delete your dev profile and remove all your posts + coins?");
    if (!ok) return;

    const res = await fetch("/api/dev/profile", { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data?.error ?? "Delete failed");

    alert("Profile deleted. You’ll need a new invite code / dev fee to come back later.");
    window.location.href = "/";
  }

  const localPreview = useMemo(() => {
    if (!pfpFile) return null;
    return URL.createObjectURL(pfpFile);
  }, [pfpFile]);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const postPreview = useMemo(() => {
    if (!postFile) return null;
    return URL.createObjectURL(postFile);
  }, [postFile]);

  useEffect(() => {
    return () => {
      if (postPreview) URL.revokeObjectURL(postPreview);
    };
  }, [postPreview]);

  const bannerLocalPreview = useMemo(() => {
    if (!bannerFile) return null;
    return URL.createObjectURL(bannerFile);
  }, [bannerFile]);

  useEffect(() => {
    return () => {
      if (bannerLocalPreview) URL.revokeObjectURL(bannerLocalPreview);
    };
  }, [bannerLocalPreview]);

  const coinBannerLocalPreview = useMemo(() => {
    if (!coinBannerFile) return null;
    return URL.createObjectURL(coinBannerFile);
  }, [coinBannerFile]);

  useEffect(() => {
    return () => {
      if (coinBannerLocalPreview) URL.revokeObjectURL(coinBannerLocalPreview);
    };
  }, [coinBannerLocalPreview]);

  const goldenHourBannerLocalPreview = useMemo(() => {
    if (!goldenHourBannerFile) return null;
    return URL.createObjectURL(goldenHourBannerFile);
  }, [goldenHourBannerFile]);

  useEffect(() => {
    return () => {
      if (goldenHourBannerLocalPreview) URL.revokeObjectURL(goldenHourBannerLocalPreview);
    };
  }, [goldenHourBannerLocalPreview]);

  const biddingAdBannerLocalPreview = useMemo(() => {
    if (!biddingAdBannerFile) return null;
    return URL.createObjectURL(biddingAdBannerFile);
  }, [biddingAdBannerFile]);

  useEffect(() => {
    return () => {
      if (biddingAdBannerLocalPreview) URL.revokeObjectURL(biddingAdBannerLocalPreview);
    };
  }, [biddingAdBannerLocalPreview]);

  useEffect(() => {
    let cancelled = false;

    async function checkAspect() {
      setBannerErr(null);
      if (!bannerFile) return;

      if (!BANNER_ALLOWED.has(bannerFile.type)) {
        setBannerErr("Invalid file type. Allowed: JPG, PNG, WEBP.");
        return;
      }

      if (bannerFile.size > BANNER_MAX_BYTES) {
        setBannerErr("File too large (max 15MB).");
        return;
      }

      try {
        const url = URL.createObjectURL(bannerFile);
        const img = new Image();
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = reject;
          img.src = url;
        });
        URL.revokeObjectURL(url);

        if (cancelled) return;
        if (!(dims.w > dims.h)) {
          setBannerErr(`Banner should be wide (recommended ${BANNER_RECOMMENDED}).`);
          return;
        }

        const ratio = dims.w / dims.h;
        if (ratio < 1.6) {
          setBannerErr(`Banner looks too square (recommended ${BANNER_RECOMMENDED}).`);
          return;
        }
      } catch {}
    }

    checkAspect();
    return () => {
      cancelled = true;
    };
  }, [bannerFile]);

  useEffect(() => {
    let cancelled = false;

    async function checkCoinAspect() {
      setCoinBannerErr(null);
      if (!coinBannerFile) return;

      if (!COIN_BANNER_ALLOWED.has(coinBannerFile.type)) {
        setCoinBannerErr("Invalid banner type. Allowed: JPG, PNG, WEBP.");
        return;
      }

      if (coinBannerFile.size > COIN_BANNER_MAX_BYTES) {
        setCoinBannerErr("Banner too large (max 15MB).");
        return;
      }

      try {
        const url = URL.createObjectURL(coinBannerFile);
        const img = new Image();
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = reject;
          img.src = url;
        });
        URL.revokeObjectURL(url);

        if (cancelled) return;
        if (!(dims.w > dims.h)) {
          setCoinBannerErr(`Banner should be wide (recommended ${COIN_BANNER_RECOMMENDED}).`);
          return;
        }

        const ratio = dims.w / dims.h;
        if (ratio < 1.6) {
          setCoinBannerErr(`Banner looks too square (recommended ${COIN_BANNER_RECOMMENDED}).`);
          return;
        }
      } catch {}
    }

    checkCoinAspect();
    return () => {
      cancelled = true;
    };
  }, [coinBannerFile]);

  useEffect(() => {
    let cancelled = false;

    async function checkGoldenHourAspect() {
      setGoldenHourBannerErr(null);
      if (!goldenHourBannerFile) return;

      if (!GOLDEN_HOUR_BANNER_ALLOWED.has(goldenHourBannerFile.type)) {
        setGoldenHourBannerErr("Invalid banner type. Allowed: JPG, PNG, WEBP.");
        return;
      }

      if (goldenHourBannerFile.size > GOLDEN_HOUR_BANNER_MAX_BYTES) {
        setGoldenHourBannerErr("Banner too large (max 15MB).");
        return;
      }

      try {
        const url = URL.createObjectURL(goldenHourBannerFile);
        const img = new Image();
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = reject;
          img.src = url;
        });
        URL.revokeObjectURL(url);

        if (cancelled) return;
        if (!(dims.w > dims.h)) {
          setGoldenHourBannerErr(`Banner should be wide (recommended ${GOLDEN_HOUR_BANNER_RECOMMENDED}).`);
          return;
        }

        const ratio = dims.w / dims.h;
        if (ratio < 1.6) {
          setGoldenHourBannerErr(`Banner looks too square (recommended ${GOLDEN_HOUR_BANNER_RECOMMENDED}).`);
          return;
        }
      } catch {}
    }

    checkGoldenHourAspect();
    return () => {
      cancelled = true;
    };
  }, [goldenHourBannerFile]);

  useEffect(() => {
    let cancelled = false;

    async function checkBiddingAdAspect() {
      setBiddingAdBannerErr(null);
      if (!biddingAdBannerFile) return;

      if (!BIDDING_AD_BANNER_ALLOWED.has(biddingAdBannerFile.type)) {
        setBiddingAdBannerErr("Invalid banner type. Allowed: JPG, PNG, WEBP.");
        return;
      }

      if (biddingAdBannerFile.size > BIDDING_AD_BANNER_MAX_BYTES) {
        setBiddingAdBannerErr("Banner too large (max 15MB).");
        return;
      }

      try {
        const url = URL.createObjectURL(biddingAdBannerFile);
        const img = new Image();
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = reject;
          img.src = url;
        });
        URL.revokeObjectURL(url);

        if (cancelled) return;
        if (!(dims.w > dims.h)) {
          setBiddingAdBannerErr(`Banner should be wide (recommended ${BIDDING_AD_BANNER_RECOMMENDED}).`);
          return;
        }

        const ratio = dims.w / dims.h;
        if (ratio < 1.6) {
          setBiddingAdBannerErr(`Banner looks too square (recommended ${BIDDING_AD_BANNER_RECOMMENDED}).`);
          return;
        }
      } catch {}
    }

    checkBiddingAdAspect();
    return () => {
      cancelled = true;
    };
  }, [biddingAdBannerFile]);

  useEffect(() => {
    if (!goldenHourEntryOpen) return;

    if (goldenHour?.entry?.coin_id) {
      setGoldenHourCoinId(goldenHour.entry.coin_id);
    } else if (goldenHour?.ownedCoins?.length === 1) {
      setGoldenHourCoinId(goldenHour.ownedCoins[0].id);
    } else if (!goldenHourCoinId) {
      setGoldenHourCoinId("");
    }

    setGoldenHourBannerErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goldenHourEntryOpen, goldenHour?.entry?.coin_id, goldenHour?.ownedCoins?.length]);

  useEffect(() => {
    if (!biddingAdEntryOpen) return;

    if (biddingAd?.entry?.coin_id) {
      setBiddingAdCoinId(biddingAd.entry.coin_id);
    } else if (biddingAd?.ownedCoins?.length === 1) {
      setBiddingAdCoinId(biddingAd.ownedCoins[0].id);
    } else if (!biddingAdCoinId) {
      setBiddingAdCoinId("");
    }

    setBiddingAdBannerErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biddingAdEntryOpen, biddingAd?.entry?.coin_id, biddingAd?.ownedCoins?.length]);

  const postButtonEnabled =
    postContent.trim().length >= 2 ||
    !!postFile ||
    (postPollQuestion.trim().length >= 2 && postPollOptions.map((x) => x.trim()).filter(Boolean).length >= 2);

  const bannerPreviewUrl = bannerLocalPreview || bannerSignedUrl;

  const goldenHourState = goldenHour?.ui?.state ?? null;
  const goldenHourAvg = goldenHour?.eligibility?.avgRating ?? null;
  const goldenHourEntryCoin =
    goldenHour?.entry?.coin_title?.trim() ||
    goldenHour?.ownedCoins?.find((c) => c.id === goldenHour?.entry?.coin_id)?.title ||
    goldenHour?.entry?.token_address ||
    null;

  const selectedGoldenHourCoin = goldenHour?.ownedCoins?.find((c) => c.id === goldenHourCoinId) ?? null;

  const biddingAdState = biddingAd?.ui?.state ?? null;
  const biddingAdAvg = biddingAd?.eligibility?.avgRating ?? null;
  const biddingAdEntryCoin =
    biddingAd?.entry?.coin_title?.trim() ||
    biddingAd?.ownedCoins?.find((c) => c.id === biddingAd?.entry?.coin_id)?.title ||
    biddingAd?.entry?.token_address ||
    null;

  const selectedBiddingAdCoin = biddingAd?.ownedCoins?.find((c) => c.id === biddingAdCoinId) ?? null;

  const biddingAdCanEdit = biddingAdState === "can_enter" || biddingAdState === "entered";
  const biddingAdPaymentPending = biddingAd?.entry?.entry_payment_status === "pending";

  const biddingAdCanSave =
    biddingAdCanEdit &&
    !!biddingAdCoinId &&
    (!!biddingAdBannerFile || !!biddingAd?.entry?.banner_path) &&
    !biddingAdBannerErr;

  function formatGoldenHourDate(iso?: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString();
  }

  function formatBiddingAdDate(iso?: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString();
  }

  function goldenHourStatusText() {
    if (!goldenHour) return "Loading Golden Hour…";
    if (goldenHourState === "not_eligible") {
      return `Your average rating must be above ${goldenHour.eligibility.minRating.toFixed(1)} to enter.`;
    }
    if (goldenHourState === "can_enter") {
      return "Opt-in is open for tomorrow’s Golden Hour.";
    }
    if (goldenHourState === "opted_in") {
      return "You’re opted in for tomorrow’s Golden Hour.";
    }
    if (goldenHourState === "won") {
      return "You have won tomorrow’s Golden Hour.";
    }
    if (goldenHourState === "lost") {
      return "You were not selected for tomorrow’s Golden Hour.";
    }
    return "Golden Hour entry is currently closed.";
  }

  function biddingAdStatusText() {
    if (!biddingAd) return "Loading Bidding Ad…";
    if (biddingAdState === "can_enter") {
      return "Entry is open. Choose your coin, upload your banner, and join the paid auction.";
    }
    if (biddingAdState === "entered") {
      return biddingAdPaymentPending
        ? "Your entry is saved, but your entry fee is still unpaid."
        : "You’re entered for tomorrow’s paid bidding ad.";
    }
    if (biddingAdState === "auction_live") {
      return "Auction is live. Go to the auction page to bid or monitor the result.";
    }
    if (biddingAdState === "won") {
      return "You won the paid ad slot.";
    }
    if (biddingAdState === "lost") {
      return "Auction ended and another dev won the paid ad slot.";
    }
    return "Entry is currently closed.";
  }

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
          <div className="relative">
            {bannerPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bannerPreviewUrl} alt="" className="h-40 w-full object-cover sm:h-48" />
            ) : (
              <div className="flex h-40 w-full items-center justify-center text-sm text-zinc-500 sm:h-48">
                No banner yet — recommended {BANNER_RECOMMENDED}
              </div>
            )}

            <div className="absolute right-3 top-3 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-zinc-200">
              Banner
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Dev banner</div>
              <div className="mt-1 text-xs text-zinc-400">
                Wide image recommended {BANNER_RECOMMENDED} • JPG/PNG/WEBP • max 15MB
              </div>
              {bannerErr ? <div className="mt-2 text-xs text-red-200">{bannerErr}</div> : null}
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
                onClick={uploadBanner}
                disabled={!bannerFile || bannerUploading || !!bannerErr}
                className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
              >
                {bannerUploading ? "Uploading…" : "Upload"}
              </button>

              {bannerFile ? (
                <button
                  type="button"
                  onClick={() => {
                    setBannerFile(null);
                    setBannerErr(null);
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <h1 className="mt-6 text-2xl font-semibold">Dev Profile</h1>
        <p className="mt-1 text-sm text-zinc-400">Edit your public profile, post updates, and list coins.</p>

        <div className="mt-6 rounded-2xl border border-yellow-400/20 bg-white/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">Golden Hour</h2>
                <span className="rounded-full border border-yellow-300/20 bg-yellow-300/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-yellow-200">
                  Free dashboard ad
                </span>
              </div>

              <p className="mt-1 text-sm text-zinc-400">
                Opt in the day before for a chance to get 1 free hour at the top of the dashboard.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setGoldenHourEntryOpen(true)}
                disabled={goldenHourLoading || goldenHourState !== "can_enter"}
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
              >
                {goldenHourLoading ? "Loading…" : goldenHourState === "can_enter" ? "Enter Golden Hour" : "Golden Hour"}
              </button>

              {goldenHour?.ui?.hasEntered && goldenHourState === "opted_in" ? (
                <button
                  type="button"
                  onClick={removeGoldenHourEntry}
                  disabled={goldenHourDeleteBusy}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
                >
                  {goldenHourDeleteBusy ? "Removing…" : "Remove entry"}
                </button>
              ) : null}
            </div>
          </div>

          {goldenHourErr ? (
            <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
              {goldenHourErr}
            </div>
          ) : null}

          {!goldenHourErr ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-semibold text-zinc-100">Status</div>
                <div className="mt-2 text-sm text-zinc-200">{goldenHourStatusText()}</div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                    Rating: {goldenHourAvg == null ? "—" : goldenHourAvg.toFixed(2)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                    Reviews: {goldenHour?.eligibility?.reviewCount ?? 0}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                    Target day: {goldenHour?.targetDate ?? "—"}
                  </span>
                </div>

                {goldenHour?.entry ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs font-semibold text-zinc-200">Current entry</div>
                    <div className="mt-2 text-sm text-zinc-300">
                      Coin: <span className="font-semibold text-zinc-100">{goldenHourEntryCoin || "Selected coin"}</span>
                    </div>
                    {goldenHour.entry.token_address ? (
                      <div className="mt-1 break-all font-mono text-xs text-zinc-500">{goldenHour.entry.token_address}</div>
                    ) : null}
                    <div className="mt-2 text-xs text-zinc-500">Banner selected and entry saved.</div>
                  </div>
                ) : null}

                {goldenHour?.winner && goldenHour?.ui?.revealLive ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs font-semibold text-zinc-200">Result</div>
                    <div className="mt-2 text-sm text-zinc-300">
                      {goldenHour.ui.iWon
                        ? "You won the Golden Hour slot."
                        : "A different dev was selected for this Golden Hour slot."}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-semibold text-zinc-100">Schedule</div>

                <div className="mt-3 space-y-2 text-sm">
                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Opt-in opens</div>
                    <div className="mt-1 text-zinc-200">{formatGoldenHourDate(goldenHour?.schedule?.optInOpensAt)}</div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Winner revealed</div>
                    <div className="mt-1 text-zinc-200">{formatGoldenHourDate(goldenHour?.schedule?.revealAt)}</div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Golden Hour starts</div>
                    <div className="mt-1 text-zinc-200">{formatGoldenHourDate(goldenHour?.schedule?.startsAt)}</div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Golden Hour ends</div>
                    <div className="mt-1 text-zinc-200">{formatGoldenHourDate(goldenHour?.schedule?.endsAt)}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-6 rounded-2xl border border-cyan-400/20 bg-white/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">Bidding Ad</h2>
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-200">
                  Paid dashboard ad
                </span>
              </div>

              <p className="mt-1 text-sm text-zinc-400">
                Enter the paid ad auction for tomorrow. Pick one of your coins and upload the banner you want to use.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {biddingAd?.ui?.hasEntered ? (
                <Link
                  href={`/ads/auction/${encodeURIComponent(biddingAd.targetDate)}`}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
                >
                  Go to auction
                </Link>
              ) : null}

              {biddingAdPaymentPending ? (
                <button
                  type="button"
                  onClick={resumeBiddingAdPayment}
                  disabled={biddingAdPayBusy}
                  className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-black hover:bg-cyan-200 disabled:opacity-60"
                >
                  {biddingAdPayBusy ? "Paying…" : `Pay ${biddingAd?.pricing?.entryFeeSol ?? 1} SOL`}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => setBiddingAdEntryOpen(true)}
                disabled={biddingAdLoading || !biddingAdCanEdit}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
              >
                {biddingAdLoading ? "Loading…" : biddingAdCanEdit ? "Enter Bidding Ad" : "Bidding Ad"}
              </button>

              {biddingAd?.ui?.hasEntered && biddingAdState === "entered" ? (
                <button
                  type="button"
                  onClick={removeBiddingAdEntry}
                  disabled={biddingAdDeleteBusy}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
                >
                  {biddingAdDeleteBusy ? "Removing…" : "Remove entry"}
                </button>
              ) : null}
            </div>
          </div>

          {biddingAdErr ? (
            <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
              {biddingAdErr}
            </div>
          ) : null}

          {!biddingAdErr ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-semibold text-zinc-100">Status</div>
                <div className="mt-2 text-sm text-zinc-200">{biddingAdStatusText()}</div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                    Entry fee: {biddingAd?.pricing?.entryFeeSol ?? 1} SOL
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                    Rating: {biddingAdAvg == null ? "—" : biddingAdAvg.toFixed(2)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                    Reviews: {biddingAd?.eligibility?.reviewCount ?? 0}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                    Target day: {biddingAd?.targetDate ?? "—"}
                  </span>
                </div>

                {biddingAd?.entry ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs font-semibold text-zinc-200">Current entry</div>
                    <div className="mt-2 text-sm text-zinc-300">
                      Coin: <span className="font-semibold text-zinc-100">{biddingAdEntryCoin || "Selected coin"}</span>
                    </div>
                    {biddingAd.entry.token_address ? (
                      <div className="mt-1 break-all font-mono text-xs text-zinc-500">{biddingAd.entry.token_address}</div>
                    ) : null}
                    <div className="mt-2 text-xs text-zinc-500">
                      Entry fee status: {biddingAd.entry.entry_payment_status}
                    </div>
                  </div>
                ) : null}

                {biddingAd?.winner ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs font-semibold text-zinc-200">Winner</div>
                    <div className="mt-2 text-sm text-zinc-300">
                      {biddingAd.ui.iWon ? "You won this bidding ad slot." : "Another dev won this bidding ad slot."}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-semibold text-zinc-100">Schedule</div>

                <div className="mt-3 space-y-2 text-sm">
                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Entry opens</div>
                    <div className="mt-1 text-zinc-200">{formatBiddingAdDate(biddingAd?.schedule?.entryOpensAt)}</div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Auction starts</div>
                    <div className="mt-1 text-zinc-200">{formatBiddingAdDate(biddingAd?.schedule?.auctionStartsAt)}</div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Auction ends</div>
                    <div className="mt-1 text-zinc-200">{formatBiddingAdDate(biddingAd?.schedule?.auctionEndsAt)}</div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Bids placed</div>
                    <div className="mt-1 text-zinc-200">{biddingAd?.auction?.bid_count ?? 0}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {goldenHourEntryOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Golden Hour entry</h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    Pick one of your coins and upload the banner you want shown if you’re selected.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setGoldenHourEntryOpen(false);
                    setGoldenHourBannerErr(null);
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm text-zinc-200">{goldenHourStatusText()}</div>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-sm font-semibold text-zinc-100">Select coin</label>
                  <select
                    value={goldenHourCoinId}
                    onChange={(e) => setGoldenHourCoinId(e.target.value)}
                    disabled={goldenHourSubmitBusy}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  >
                    <option value="">Choose one of your coins</option>
                    {(goldenHour?.ownedCoins ?? []).map((coin) => (
                      <option key={coin.id} value={coin.id}>
                        {coin.title?.trim() || coin.token_address}
                      </option>
                    ))}
                  </select>

                  {selectedGoldenHourCoin ? (
                    <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-sm text-zinc-200">
                        {selectedGoldenHourCoin.title?.trim() || "Untitled coin"}
                      </div>
                      <div className="mt-1 break-all font-mono text-xs text-zinc-500">
                        {selectedGoldenHourCoin.token_address}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">Golden Hour banner</div>
                      <div className="mt-1 text-xs text-zinc-400">
                        Wide image recommended {GOLDEN_HOUR_BANNER_RECOMMENDED} • JPG/PNG/WEBP • max 15MB
                      </div>
                      {goldenHourBannerErr ? <div className="mt-2 text-xs text-red-200">{goldenHourBannerErr}</div> : null}
                    </div>

                    {goldenHourBannerFile ? (
                      <button
                        type="button"
                        onClick={() => {
                          setGoldenHourBannerFile(null);
                          setGoldenHourBannerErr(null);
                        }}
                        className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
                      Choose banner
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          setGoldenHourBannerFile(f);
                        }}
                      />
                    </label>

                    {goldenHourBannerFile ? (
                      <span className="text-xs text-zinc-400">
                        {goldenHourBannerFile.name} • {(goldenHourBannerFile.size / (1024 * 1024)).toFixed(2)}MB
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-500">No banner selected.</span>
                    )}
                  </div>

                  {goldenHourBannerLocalPreview ? (
                    <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={goldenHourBannerLocalPreview} alt="" className="h-40 w-full object-cover" />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  onClick={removeGoldenHourEntry}
                  disabled={!goldenHour?.ui?.hasEntered || goldenHourDeleteBusy || goldenHourSubmitBusy}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
                >
                  {goldenHourDeleteBusy ? "Removing…" : "Remove entry"}
                </button>

                <button
                  type="button"
                  onClick={submitGoldenHourEntry}
                  disabled={
                    goldenHourSubmitBusy ||
                    goldenHourState !== "can_enter" ||
                    !goldenHourCoinId ||
                    !goldenHourBannerFile ||
                    !!goldenHourBannerErr
                  }
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                >
                  {goldenHourSubmitBusy ? "Saving…" : goldenHour?.ui?.hasEntered ? "Update entry" : "Save entry"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {biddingAdEntryOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Bidding Ad entry</h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    Pick your coin and banner for tomorrow’s paid auction. Entry fee: {biddingAd?.pricing?.entryFeeSol ?? 1} SOL.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setBiddingAdEntryOpen(false);
                    setBiddingAdBannerErr(null);
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm text-zinc-200">{biddingAdStatusText()}</div>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-sm font-semibold text-zinc-100">Select coin</label>
                  <select
                    value={biddingAdCoinId}
                    onChange={(e) => setBiddingAdCoinId(e.target.value)}
                    disabled={biddingAdSubmitBusy || biddingAdPayBusy}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  >
                    <option value="">Choose one of your coins</option>
                    {(biddingAd?.ownedCoins ?? []).map((coin) => (
                      <option key={coin.id} value={coin.id}>
                        {coin.title?.trim() || coin.token_address}
                      </option>
                    ))}
                  </select>

                  {selectedBiddingAdCoin ? (
                    <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-sm text-zinc-200">
                        {selectedBiddingAdCoin.title?.trim() || "Untitled coin"}
                      </div>
                      <div className="mt-1 break-all font-mono text-xs text-zinc-500">
                        {selectedBiddingAdCoin.token_address}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">Bidding Ad banner</div>
                      <div className="mt-1 text-xs text-zinc-400">
                        Wide image recommended {BIDDING_AD_BANNER_RECOMMENDED} • JPG/PNG/WEBP • max 15MB
                      </div>
                      {biddingAdBannerErr ? <div className="mt-2 text-xs text-red-200">{biddingAdBannerErr}</div> : null}
                    </div>

                    {biddingAdBannerFile ? (
                      <button
                        type="button"
                        onClick={() => {
                          setBiddingAdBannerFile(null);
                          setBiddingAdBannerErr(null);
                        }}
                        className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
                      Choose banner
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          setBiddingAdBannerFile(f);
                        }}
                      />
                    </label>

                    {biddingAdBannerFile ? (
                      <span className="text-xs text-zinc-400">
                        {biddingAdBannerFile.name} • {(biddingAdBannerFile.size / (1024 * 1024)).toFixed(2)}MB
                      </span>
                    ) : biddingAd?.entry?.banner_path ? (
                      <span className="text-xs text-zinc-500">Using your saved banner unless you choose a new one.</span>
                    ) : (
                      <span className="text-xs text-zinc-500">No banner selected.</span>
                    )}
                  </div>

                  {biddingAdBannerLocalPreview ? (
                    <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={biddingAdBannerLocalPreview} alt="" className="h-40 w-full object-cover" />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  onClick={removeBiddingAdEntry}
                  disabled={!biddingAd?.ui?.hasEntered || biddingAdDeleteBusy || biddingAdSubmitBusy || biddingAdPayBusy}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
                >
                  {biddingAdDeleteBusy ? "Removing…" : "Remove entry"}
                </button>

                <div className="flex flex-wrap gap-2">
                  {biddingAdPaymentPending ? (
                    <button
                      type="button"
                      onClick={resumeBiddingAdPayment}
                      disabled={biddingAdSubmitBusy || biddingAdPayBusy}
                      className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
                    >
                      {biddingAdPayBusy ? "Paying…" : `Pay ${biddingAd?.pricing?.entryFeeSol ?? 1} SOL`}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={submitBiddingAdEntry}
                    disabled={biddingAdSubmitBusy || biddingAdPayBusy || !biddingAdCanSave}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                  >
                    {biddingAdSubmitBusy
                      ? "Saving…"
                      : biddingAdPaymentPending
                      ? `Save & pay ${biddingAd?.pricing?.entryFeeSol ?? 1} SOL`
                      : biddingAd?.ui?.hasEntered
                      ? "Update entry"
                      : `Save & pay ${biddingAd?.pricing?.entryFeeSol ?? 1} SOL`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Profile</h2>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 overflow-hidden rounded-full border border-white/10 bg-white/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {localPreview || pfpSignedUrl ? (
                      <img src={localPreview || pfpSignedUrl || ""} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    <div className="text-sm font-semibold">Profile picture</div>
                    <div className="mt-1 text-xs text-zinc-400">JPG / PNG / WEBP • max 5MB</div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
                        Choose photo
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0] || null;
                            setPfpFile(f);
                          }}
                        />
                      </label>

                      <button
                        onClick={uploadPfp}
                        disabled={!pfpFile || pfpUploading}
                        className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                      >
                        {pfpUploading ? "Uploading…" : "Upload"}
                      </button>

                      {pfpFile ? (
                        <button
                          onClick={() => setPfpFile(null)}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <input
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <input
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="X/Twitter URL (optional)"
                  value={xUrl}
                  onChange={(e) => setXUrl(e.target.value)}
                />
                <textarea
                  className="min-h-[100px] rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Bio (optional)"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                />
              </div>

              <button
                onClick={saveProfile}
                className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
              >
                Save profile
              </button>

              <button
                onClick={deleteProfile}
                className="mt-3 w-full rounded-xl bg-red-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
              >
                Delete profile
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Post an update</h2>

              <textarea
                className="mt-3 min-h-[110px] w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                placeholder="e.g. Launching something soon…"
                value={postContent}
                onChange={(e) => setPostContent(e.target.value)}
                maxLength={500}
              />

              <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-semibold">Add a poll (optional)</div>
                <div className="mt-1 text-xs text-zinc-400">
                  If you start a poll, you must add a question + 2 options.
                </div>

                <input
                  className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  placeholder="Poll question…"
                  value={postPollQuestion}
                  onChange={(e) => setPostPollQuestion(e.target.value)}
                  disabled={postBusy || postPollBusy}
                />

                <div className="mt-2 grid gap-2">
                  {postPollOptions.map((v, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                        placeholder={`Option ${idx + 1}`}
                        value={v}
                        onChange={(e) => {
                          const next = [...postPollOptions];
                          next[idx] = e.target.value;
                          setPostPollOptions(next);
                        }}
                        disabled={postBusy || postPollBusy}
                      />
                      {postPollOptions.length > 2 ? (
                        <button
                          type="button"
                          onClick={() => setPostPollOptions((prev) => prev.filter((_, i) => i !== idx))}
                          disabled={postBusy || postPollBusy}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (postPollOptions.length >= 6) return;
                      setPostPollOptions((prev) => [...prev, ""]);
                    }}
                    disabled={postBusy || postPollBusy || postPollOptions.length >= 6}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                  >
                    Add option
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPostPollQuestion("");
                      setPostPollOptions(["", ""]);
                    }}
                    disabled={postBusy || postPollBusy}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                  >
                    Clear poll
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Attach a photo (optional)</div>
                    <div className="mt-1 text-xs text-zinc-400">JPG / PNG / WEBP • max 5MB</div>
                  </div>

                  {postFile ? (
                    <button
                      type="button"
                      onClick={() => setPostFile(null)}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
                    Choose photo
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setPostFile(f);
                      }}
                    />
                  </label>
                  {postFile ? (
                    <span className="text-xs text-zinc-400">
                      {postFile.name} • {(postFile.size / (1024 * 1024)).toFixed(2)}MB
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500">No image selected.</span>
                  )}
                </div>

                {postPreview ? (
                  <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={postPreview} alt="" className="max-h-[360px] w-full object-cover" />
                  </div>
                ) : null}
              </div>

              <button
                onClick={createPost}
                disabled={postBusy || !postButtonEnabled}
                className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
              >
                {postBusy ? "Posting…" : "Post update"}
              </button>

              <div className="mt-6">
                <h3 className="text-sm font-semibold text-zinc-200">Recent updates</h3>
                <div className="mt-3 space-y-2">
                  {posts.length === 0 ? (
                    <div className="text-sm text-zinc-500">No posts yet.</div>
                  ) : (
                    posts.slice(0, 8).map((p) => (
                      <div key={p.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <div className="text-xs text-zinc-500">{new Date(p.created_at).toLocaleString()}</div>
                        <div className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-200">{p.content}</div>

                        {p.image_url ? (
                          <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.image_url} alt="" className="max-h-[420px] w-full object-cover" />
                          </div>
                        ) : null}

                        {p.poll ? <PollCard poll={p.poll} /> : null}
                      </div>
                    ))
                  )}
                </div>

                <p className="mt-3 text-[11px] text-zinc-500">
                  If polls don’t show: make sure your <span className="font-mono">/api/dev/profile</span> GET is
                  returning <span className="font-mono">poll</span> for each post (with options + votes + viewer_vote).
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 lg:col-span-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Coins</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Coins you post are permanent and cannot be removed individually.
                  </p>
                </div>

                <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
                  Immutable
                </span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <input
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Token address"
                  value={coinAddr}
                  onChange={(e) => setCoinAddr(e.target.value)}
                />
                <input
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Title (optional)"
                  value={coinTitle}
                  onChange={(e) => setCoinTitle(e.target.value)}
                />
                <input
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Short description (optional)"
                  value={coinDesc}
                  onChange={(e) => setCoinDesc(e.target.value)}
                />
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">Coin banner (optional)</div>
                    <div className="mt-1 text-xs text-zinc-400">
                      Wide image recommended {COIN_BANNER_RECOMMENDED} • JPG/PNG/WEBP • max 15MB
                    </div>
                    {coinBannerErr ? <div className="mt-2 text-xs text-red-200">{coinBannerErr}</div> : null}
                  </div>

                  {coinBannerFile ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCoinBannerFile(null);
                        setCoinBannerErr(null);
                      }}
                      className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
                    Choose banner
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setCoinBannerFile(f);
                      }}
                    />
                  </label>

                  {coinBannerFile ? (
                    <span className="text-xs text-zinc-400">
                      {coinBannerFile.name} • {(coinBannerFile.size / (1024 * 1024)).toFixed(2)}MB
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500">No banner selected.</span>
                  )}
                </div>

                {coinBannerLocalPreview ? (
                  <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={coinBannerLocalPreview} alt="" className="h-40 w-full object-cover" />
                  </div>
                ) : null}
              </div>

              <button
                onClick={addCoin}
                className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
              >
                Add coin
              </button>

              <div className="mt-5 grid gap-2">
                {coins.length === 0 ? (
                  <div className="text-sm text-zinc-500">No coins yet.</div>
                ) : (
                  coins.map((c) => {
                    const mint = c.token_address;
                    const meta = metaByMint[mint];
                    const loadingMeta = !!metaLoadingMints[mint];

                    const display = meta?.name || c.title || "Untitled coin";
                    const symbol = meta?.symbol || null;
                    const logo = meta?.image || null;

                    const community = communityByCoinId[c.id];
                    const loadingComm = !!communityLoadingByCoinId[c.id];
                    const creatingComm = !!communityCreatingByCoinId[c.id];

                    return (
                      <div
                        key={c.id}
                        className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
                      >
                        <div className="flex min-w-0 gap-3">
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
                              <div className="text-sm font-semibold text-zinc-200">{display}</div>
                              {symbol ? (
                                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-300">
                                  {symbol}
                                </span>
                              ) : null}
                              {loadingMeta ? <span className="text-[11px] text-zinc-500">Loading…</span> : null}
                              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-300">
                                Posted
                              </span>
                            </div>

                            <div className="mt-1 break-all font-mono text-xs text-zinc-400">{c.token_address}</div>
                            {c.description ? <div className="mt-1 text-xs text-zinc-300">{c.description}</div> : null}
                            <div className="mt-2 text-[11px] text-zinc-500">
                              {new Date(c.created_at).toLocaleString()}
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-2">
                          {community ? (
                            <>
                              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
                                Community live
                              </span>
                              <Link
                                href={`/community/${encodeURIComponent(community.id)}`}
                                className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-zinc-200"
                              >
                                Open →
                              </Link>
                            </>
                          ) : (
                            <>
                              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
                                {loadingComm ? "Checking…" : "No community"}
                              </span>
                              <button
                                type="button"
                                disabled={loadingComm || creatingComm}
                                onClick={() => createCommunity(c, display)}
                                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                              >
                                {creatingComm ? "Creating…" : "Create community"}
                              </button>
                            </>
                          )}

                          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
                            Permanent
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
