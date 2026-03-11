"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import UpgradeModal from "@/components/UpgradeModal";
import LiveStreamBroadcaster from "@/components/LiveStreamBroadcaster";
import LiveStreamViewer from "@/components/LiveStreamViewer";

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

type Message = {
  id: string;
  community_id: string;
  author_wallet: string;
  author_name?: string | null;
  author_pfp_url?: string | null;
  is_dev?: boolean;
  text: string | null;
  image_url: string | null;
  poll?: Poll | null; // ✅ NEW
  created_at: string;
};

type CommunityPayload = {
  ok: true;
  community: {
    id: string;
    coin_id: string;
    dev_wallet: string;
    title: string | null;
    created_at: string;
    viewerRole: "dev" | "member" | null;
    membersCount?: number;
    pinned_message_id?: string | null;
  };
  coin?: {
    id: string;
    token_address: string;
    name: string | null;
    symbol: string | null;
    image: string | null;
  } | null;
  pinnedMessage?: Message | null;
  messages?: Message[];
  nextCursor?: string | null;
};

type LiveMeta = {
  ok: true;
  mint: string;
  name: string | null;
  symbol: string | null;
  image: string | null;
  dexImage?: string | null;
  note?: string;
  updatedAt?: string;
};

type LiveStream = {
  id: string;
  room_name: string;
  dev_wallet: string;
  title: string | null;
  has_video: boolean;
  viewer_count: number;
  started_at: string;
};

function shortAddr(s: string) {
  if (!s) return "";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function fmtTime(ts: string) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export default function CommunityPage({ params }: { params: Promise<{ id: string }> }) {
  const [communityId, setCommunityId] = useState("");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<CommunityPayload | null>(null);

  const [msgs, setMsgs] = useState<Message[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);

  // post box
  const [text, setText] = useState("");
  const [sendBusy, setSendBusy] = useState(false);

  // upload state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  // ✅ poll composer (dev-only)
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollBusy, setPollBusy] = useState(false);

  const [joinBusy, setJoinBusy] = useState(false);
  const [trialToast, setTrialToast] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // pin busy
  const [pinBusyId, setPinBusyId] = useState<string | null>(null);

  // coin live meta (for coin image in header)
  const [coinLive, setCoinLive] = useState<LiveMeta | null>(null);

  // live stream state
  const [liveStream, setLiveStream] = useState<LiveStream | null>(null);
  const [streamChecked, setStreamChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await params;
      setCommunityId(p.id);
    })();
  }, [params]);

  const viewerRole = data?.community?.viewerRole ?? null;
  const isMember = viewerRole === "member" || viewerRole === "dev";
  const isDevViewer = viewerRole === "dev";

  const pinnedId = (data?.community?.pinned_message_id ?? null) as string | null;

  const headerTitle = useMemo(() => {
    const c = data?.community;
    const coin = data?.coin;
    const t = c?.title || coin?.name || "Community";
    const sym = coin?.symbol ? ` (${coin.symbol})` : "";
    return `${t}${sym}`;
  }, [data?.community, data?.coin]);

  // prefer coin-live image (same as coin page), fallback to API coin.image (usually null)
  const headerLogoUrl = useMemo(() => {
    return (coinLive?.image || coinLive?.dexImage || data?.coin?.image || null) as string | null;
  }, [coinLive?.image, coinLive?.dexImage, data?.coin?.image]);

  function mergeUniqueById(prev: Message[], incoming: Message[]) {
    const map = new Map<string, Message>();
    for (const m of prev) map.set(m.id, m);
    for (const m of incoming) map.set(m.id, m);

    const all = Array.from(map.values());
    all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return all;
  }

  async function loadInitial({ scrollToBottom = true }: { scrollToBottom?: boolean } = {}) {
    if (!communityId) return;
    setLoading(true);
    setErr(null);

    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, {
        cache: "no-store"
      });
      const json = (await res.json().catch(() => null)) as CommunityPayload | null;
      if (!res.ok) throw new Error((json as any)?.error || "Failed to load community");

      setData(json as CommunityPayload);
      setMsgs((json?.messages ?? []) as Message[]);
      setNextCursor(json?.nextCursor ?? null);

      if (scrollToBottom) {
        setTimeout(() => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
        }, 50);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load community");
      setData(null);
      setMsgs([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId]);

  // Load coin image/meta for header using /api/coin-live (matches coin page)
  useEffect(() => {
    const mint = (data?.coin?.token_address || "").trim();
    if (!mint) {
      setCoinLive(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/coin-live?mint=${encodeURIComponent(mint)}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          if (!cancelled) setCoinLive(null);
          return;
        }
        if (!cancelled) setCoinLive(json as LiveMeta);
      } catch {
        if (!cancelled) setCoinLive(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data?.coin?.token_address]);

  // Check for active stream on load and poll every 15s
  async function checkStream() {
    if (!communityId) return;
    try {
      const res = await fetch(`/api/livekit/stream?communityId=${encodeURIComponent(communityId)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setLiveStream(json?.stream ?? null);
        setStreamChecked(true);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!communityId) return;
    checkStream();
    const t = setInterval(checkStream, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId]);

  useEffect(() => {
    if (!communityId) return;
    if (!isMember) return;

    let alive = true;

    const t = setInterval(async () => {
      if (!alive) return;
      try {
        const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as CommunityPayload | null;
        if (!res.ok || !json?.ok) return;

        setMsgs((prev) => mergeUniqueById(prev, (json.messages ?? []) as Message[]));
        setNextCursor(json.nextCursor ?? null);
        setData(json as CommunityPayload);
      } catch {
        // ignore
      }
    }, 10_000);

    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, isMember]);

  async function loadOlder() {
    if (!communityId || !nextCursor || olderBusy) return;
    setOlderBusy(true);
    try {
      const res = await fetch(
        `/api/communities/${encodeURIComponent(communityId)}?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as CommunityPayload | null;
      if (!res.ok) throw new Error((json as any)?.error || "Failed to load older messages");

      setMsgs((prev) => mergeUniqueById(prev, (json?.messages ?? []) as Message[]));
      setNextCursor(json?.nextCursor ?? null);

      if (listRef.current) listRef.current.scrollTop = 80;
    } catch (e: any) {
      alert(e?.message ?? "Failed to load older messages");
    } finally {
      setOlderBusy(false);
    }
  }

  async function join() {
    if (!communityId) return;
    setJoinBusy(true);
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/join`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json?.code === "TRIAL_RESTRICTED") { setTrialToast(true); return; }
        throw new Error(json?.error || "Join failed");
      }
      await loadInitial();
    } catch (e: any) {
      alert(e?.message ?? "Join failed");
    } finally {
      setJoinBusy(false);
    }
  }

  async function leave() {
    if (!communityId) return;
    const ok = confirm("Leave this community?");
    if (!ok) return;

    setJoinBusy(true);
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/leave`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Leave failed");
      await loadInitial();
    } catch (e: any) {
      alert(e?.message ?? "Leave failed");
    } finally {
      setJoinBusy(false);
    }
  }

  // local preview URL for selected image
  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }
    const u = URL.createObjectURL(imageFile);
    setImagePreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [imageFile]);

  async function uploadImage() {
    if (!communityId || !imageFile) return;
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", imageFile);

      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/upload`, {
        method: "POST",
        body: fd
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Upload failed");

      setImagePath(json?.path ?? null);
    } catch (e: any) {
      alert(e?.message ?? "Upload failed");
    } finally {
      setImageUploading(false);
    }
  }

  function clearImage() {
    setImageFile(null);
    setImagePath(null);
    setImagePreviewUrl(null);
  }

  async function send() {
    if (!communityId) return;
    const t = text.trim();
    if (!t && !imagePath) return;

    setSendBusy(true);
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t || null, image_path: imagePath })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json?.code === "TRIAL_RESTRICTED") { setTrialToast(true); return; }
        throw new Error(json?.error || "Send failed");
      }

      setText("");
      clearImage();

      await loadInitial({ scrollToBottom: true });
    } catch (e: any) {
      alert(e?.message ?? "Send failed");
    } finally {
      setSendBusy(false);
    }
  }

  async function setPinned(messageIdOrNull: string | null) {
    if (!communityId) return;
    setPinBusyId(messageIdOrNull || "unpin");
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageIdOrNull })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Pin failed");

      // refresh payload to get pinnedMessage hydrated
      await loadInitial({ scrollToBottom: false });
    } catch (e: any) {
      alert(e?.message ?? "Pin failed");
    } finally {
      setPinBusyId(null);
    }
  }

  // ✅ Vote in a community poll
  async function votePoll(pollId: string, optionId: string) {
    if (!communityId) return;
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/polls/${encodeURIComponent(pollId)}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ option_id: optionId })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json?.code === "TRIAL_RESTRICTED") { setTrialToast(true); return; }
        throw new Error(json?.error || "Vote failed");
      }

      // refresh to update counts + viewer_vote
      await loadInitial({ scrollToBottom: false });
    } catch (e: any) {
      alert(e?.message ?? "Vote failed");
    }
  }

  // ✅ Create a poll (dev only) in this community
  async function createPoll() {
    if (!communityId) return;

    const q = pollQuestion.trim();
    const opts = pollOptions.map((x) => x.trim()).filter(Boolean);

    if (q.length < 2) return alert("Poll question is too short.");
    if (opts.length < 2) return alert("Poll needs at least 2 options.");

    setPollBusy(true);
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/polls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, options: opts })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Create poll failed");

      setPollQuestion("");
      setPollOptions(["", ""]);
      await loadInitial({ scrollToBottom: true });
    } catch (e: any) {
      alert(e?.message ?? "Create poll failed");
    } finally {
      setPollBusy(false);
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
                onClick={() => votePoll(poll.id, o.id)}
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

        <div className="mt-2 text-[11px] text-zinc-500">{total} total vote{total === 1 ? "" : "s"}</div>
      </div>
    );
  }

  function MessageCard({ m }: { m: Message }) {
    const name = (m.author_name || "").trim() || shortAddr(m.author_wallet);
    const isPinned = pinnedId === m.id;

    return (
      <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-8 w-8 overflow-hidden rounded-full border border-white/10 bg-white/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.author_pfp_url ? <img src={m.author_pfp_url} alt="" className="h-full w-full object-cover" /> : null}
            </div>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <a
                  href={m.is_dev ? `/dev/${encodeURIComponent(m.author_wallet)}` : `/user/${encodeURIComponent(m.author_wallet)}`}
                  className="truncate text-sm font-semibold hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {name}
                </a>
                {m.is_dev ? (
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-200">
                    DEV
                  </span>
                ) : null}
                {isPinned ? (
                  <span className="shrink-0 rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-zinc-200">
                    📌 PINNED
                  </span>
                ) : null}
              </div>
              <a
                href={m.is_dev ? `/dev/${encodeURIComponent(m.author_wallet)}` : `/user/${encodeURIComponent(m.author_wallet)}`}
                className="font-mono text-[11px] text-zinc-500 hover:text-zinc-300"
                onClick={(e) => e.stopPropagation()}
              >
                {shortAddr(m.author_wallet)}
              </a>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="shrink-0 text-[11px] text-zinc-500">{fmtTime(m.created_at)}</div>

            {isDevViewer ? (
              <button
                type="button"
                onClick={() => setPinned(isPinned ? null : m.id)}
                disabled={!!pinBusyId}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] hover:bg-white/10 disabled:opacity-60"
                title={isPinned ? "Unpin" : "Pin"}
              >
                {pinBusyId ? "…" : isPinned ? "Unpin" : "Pin"}
              </button>
            ) : null}
          </div>
        </div>

        {m.text ? <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">{m.text}</div> : null}

        {m.image_url ? (
          <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.image_url} alt="" className="max-h-[420px] w-full object-cover" />
          </div>
        ) : null}

        {/* ✅ poll */}
        {m.poll ? <PollCard poll={m.poll} /> : null}
      </div>
    );
  }

  const pinnedMessage = data?.pinnedMessage ?? null;

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href="/account" className="text-sm text-zinc-400 hover:text-white">
              ← Back to account
            </Link>

            <div className="mt-3 flex items-center gap-3">
              <div className="h-10 w-10 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {headerLogoUrl ? <img src={headerLogoUrl} alt="" className="h-full w-full object-cover" /> : null}
              </div>

              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold">{headerTitle}</h1>
                <div className="mt-0.5 text-xs text-zinc-400">
                  {data?.coin?.token_address ? (
                    <span className="font-mono">{data.coin.token_address}</span>
                  ) : (
                    <span className="font-mono">{communityId ? shortAddr(communityId) : "…"}</span>
                  )}
                  {typeof data?.community?.membersCount === "number" ? (
                    <span className="ml-2 text-zinc-500">• {data.community.membersCount} members</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {!loading && data?.community ? (
            isMember ? (
              <button
                onClick={leave}
                disabled={joinBusy}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
              >
                Leave
              </button>
            ) : (
              <button
                onClick={join}
                disabled={joinBusy}
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
              >
                {joinBusy ? "Joining…" : "Join community"}
              </button>
            )
          ) : null}
        </div>

        {loading ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : err ? (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-200">
            {err}
          </div>
        ) : !data?.community ? null : !isMember ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold">This community is private</h2>
            <p className="mt-2 text-sm text-zinc-400">You can’t view messages until you join.</p>

            <button
              onClick={join}
              disabled={joinBusy}
              className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
            >
              {joinBusy ? "Joining…" : "Join community"}
            </button>

            <p className="mt-3 text-xs text-zinc-500">Anyone can join.</p>
          </div>
        ) : (
          <>
            {/* ── Live Stream section ──────────────────────────────────────── */}
            {streamChecked && isDevViewer && (
              <div className="mt-6">
                {liveStream ? (
                  /* Dev is already live — show broadcaster controls */
                  <LiveStreamBroadcaster
                    communityId={communityId}
                    devWallet={data.community.dev_wallet}
                    onEnded={() => {
                      setLiveStream(null);
                      checkStream();
                    }}
                  />
                ) : (
                  /* Dev is not live — show go live panel */
                  <LiveStreamBroadcaster
                    communityId={communityId}
                    devWallet={data.community.dev_wallet}
                    onEnded={() => {
                      setLiveStream(null);
                    }}
                  />
                )}
              </div>
            )}

            {/* Viewer sees the stream when live (and they're a member but not the dev) */}
            {streamChecked && !isDevViewer && liveStream && (
              <div className="mt-6">
                <LiveStreamViewer
                  communityId={communityId}
                  stream={{
                    roomName:    liveStream.room_name,
                    devWallet:   liveStream.dev_wallet,
                    title:       liveStream.title,
                    hasVideo:    liveStream.has_video,
                    viewerCount: liveStream.viewer_count,
                    startedAt:   liveStream.started_at,
                  }}
                  devName={null}
                  devPfpUrl={null}
                />
              </div>
            )}

            <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3 px-2 pb-3">
                <div className="text-sm font-semibold">Chat</div>

                {nextCursor ? (
                  <button
                    onClick={loadOlder}
                    disabled={olderBusy}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-60"
                  >
                    {olderBusy ? "Loading…" : "Load older"}
                  </button>
                ) : (
                  <span className="text-xs text-zinc-500">No older messages</span>
                )}
              </div>

              {/* ✅ PINNED MESSAGE */}
              {pinnedMessage ? (
                <div className="mb-3 rounded-2xl border border-white/10 bg-black/40 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-zinc-200">📌 Pinned</div>
                    {isDevViewer ? (
                      <button
                        type="button"
                        onClick={() => setPinned(null)}
                        disabled={!!pinBusyId}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] hover:bg-white/10 disabled:opacity-60"
                      >
                        {pinBusyId ? "…" : "Unpin"}
                      </button>
                    ) : null}
                  </div>
                  <MessageCard m={pinnedMessage} />
                </div>
              ) : null}

              <div ref={listRef} className="h-[520px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3">
                {msgs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-500">No messages yet. Say hi 👋</div>
                ) : (
                  <div className="space-y-2">
                    {msgs.map((m) => (
                      <MessageCard key={m.id} m={m} />
                    ))}
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="mt-3 grid gap-2">
                {/* ✅ DEV ONLY: poll composer */}
                {isDevViewer ? (
                  <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
                    <div className="text-xs font-semibold text-zinc-200">Create a poll (dev only)</div>

                    <input
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                      placeholder="Poll question…"
                      value={pollQuestion}
                      onChange={(e) => setPollQuestion(e.target.value)}
                      disabled={pollBusy}
                    />

                    <div className="mt-2 grid gap-2">
                      {pollOptions.map((v, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                            placeholder={`Option ${idx + 1}`}
                            value={v}
                            onChange={(e) => {
                              const next = [...pollOptions];
                              next[idx] = e.target.value;
                              setPollOptions(next);
                            }}
                            disabled={pollBusy}
                          />
                          {pollOptions.length > 2 ? (
                            <button
                              type="button"
                              onClick={() => {
                                const next = pollOptions.filter((_, i) => i !== idx);
                                setPollOptions(next);
                              }}
                              disabled={pollBusy}
                              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                              title="Remove option"
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
                          if (pollOptions.length >= 6) return;
                          setPollOptions((prev) => [...prev, ""]);
                        }}
                        disabled={pollBusy || pollOptions.length >= 6}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
                      >
                        Add option
                      </button>

                      <button
                        type="button"
                        onClick={createPoll}
                        disabled={pollBusy}
                        className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                      >
                        {pollBusy ? "Creating…" : "Create poll"}
                      </button>
                    </div>

                    <p className="mt-2 text-[11px] text-zinc-500">Polls appear in chat like a pinned-style card. Members can vote.</p>
                  </div>
                ) : null}

                <textarea
                  className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Write a message…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={sendBusy}
                />

                {/* Image upload */}
                <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
                      Choose image
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          setImageFile(f);
                          setImagePath(null);
                        }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={uploadImage}
                      disabled={!imageFile || imageUploading || !!imagePath}
                      className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                    >
                      {imagePath ? "Uploaded ✓" : imageUploading ? "Uploading…" : "Upload"}
                    </button>

                    {imageFile || imagePath ? (
                      <button
                        type="button"
                        onClick={clearImage}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  {imagePreviewUrl ? (
                    <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imagePreviewUrl} alt="" className="max-h-[260px] w-full object-cover" />
                    </div>
                  ) : null}

                  <p className="mt-2 text-[11px] text-zinc-500">Upload first, then send. Images are private (signed URLs).</p>
                </div>

                <button
                  onClick={send}
                  disabled={sendBusy || (!text.trim() && !imagePath)}
                  className="w-full rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                >
                  {sendBusy ? "Sending…" : "Send"}
                </button>

                <p className="text-[11px] text-zinc-500">
                  No “load newer” button — new messages auto-refresh. Use “Load older” to scroll back.
                </p>
              </div>
            </div>

            {data.coin?.id ? (
              <div className="mt-4">
                <Link
                  href={`/coin/${encodeURIComponent(data.coin.id)}`}
                  className="inline-block rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  Back to coin →
                </Link>
              </div>
            ) : null}
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
