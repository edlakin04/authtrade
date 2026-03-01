"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

type CommunityPayload = {
  ok: true;
  community: {
    id: string;
    coin_id: string;
    dev_wallet: string;
    title: string | null;
    created_at: string;
    viewerRole: "dev" | "member" | null; // null = not joined
    membersCount?: number;
  };
  coin?: {
    id: string;
    token_address: string;
    name: string | null;
    symbol: string | null;
    image: string | null;
  } | null;
  messages?: Array<{
    id: string;
    community_id: string;
    author_wallet: string;
    author_name?: string | null; // preferred (dev display_name)
    author_pfp_url?: string | null; // optional
    text: string | null;
    image_url: string | null;
    created_at: string;
  }>;
  nextCursor?: string | null; // for older pagination
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

  // messages + paging
  const [msgs, setMsgs] = useState<NonNullable<CommunityPayload["messages"]>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);

  // post box
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState(""); // (stage later: file upload)
  const [sendBusy, setSendBusy] = useState(false);

  // join/leave
  const [joinBusy, setJoinBusy] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const p = await params;
      setCommunityId(p.id);
    })();
  }, [params]);

  const viewerRole = data?.community?.viewerRole ?? null;
  const isMember = viewerRole === "member" || viewerRole === "dev";

  const headerTitle = useMemo(() => {
    const c = data?.community;
    const coin = data?.coin;
    const t = c?.title || coin?.name || "Community";
    const sym = coin?.symbol ? ` (${coin.symbol})` : "";
    return `${t}${sym}`;
  }, [data?.community, data?.coin]);

  function mergeUniqueById(
    prev: NonNullable<CommunityPayload["messages"]>,
    incoming: NonNullable<CommunityPayload["messages"]>,
    mode: "prepend" | "append"
  ) {
    const map = new Map<string, (typeof prev)[number]>();
    for (const m of prev) map.set(m.id, m);
    for (const m of incoming) map.set(m.id, m);
    const all = Array.from(map.values());
    all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    // mode affects scroll behavior; ordering stays chronological
    return all;
  }

  async function loadInitial() {
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
      const initial = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs(initial);
      setNextCursor(json?.nextCursor ?? null);

      // scroll to bottom after first load if member
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
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

  // Poll for new messages (no "load newer" button)
  useEffect(() => {
    if (!communityId) return;
    if (!isMember) return;

    let alive = true;

    const t = setInterval(async () => {
      if (!alive) return;

      try {
        // simplest: re-fetch latest (API should return latest messages)
        const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, {
          cache: "no-store"
        });
        const json = (await res.json().catch(() => null)) as CommunityPayload | null;
        if (!res.ok || !json?.ok) return;

        const incoming = (json.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
        setMsgs((prev) => mergeUniqueById(prev, incoming, "append"));

        // keep nextCursor updated too (older pagination)
        setNextCursor(json.nextCursor ?? null);
        setData((prev) => (prev ? { ...prev, community: { ...prev.community, viewerRole: json.community.viewerRole } } : json));
      } catch {
        // ignore transient errors
      }
    }, 10_000);

    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, isMember]);

  async function loadOlder() {
    if (!communityId) return;
    if (!nextCursor) return;
    if (olderBusy) return;

    setOlderBusy(true);
    try {
      const res = await fetch(
        `/api/communities/${encodeURIComponent(communityId)}?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as CommunityPayload | null;
      if (!res.ok) throw new Error((json as any)?.error || "Failed to load older messages");

      const incoming = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs((prev) => mergeUniqueById(prev, incoming, "prepend"));
      setNextCursor(json?.nextCursor ?? null);

      // keep scroll stable-ish by nudging a bit
      if (listRef.current) {
        listRef.current.scrollTop = 80;
      }
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
      if (!res.ok) throw new Error(json?.error || "Join failed");
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

  async function send() {
    if (!communityId) return;
    const t = text.trim();
    const img = imageUrl.trim() || null;

    if (!t && !img) return;

    setSendBusy(true);
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t || null, image_url: img })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Send failed");

      setText("");
      setImageUrl("");

      // Refresh latest after sending
      const res2 = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, { cache: "no-store" });
      const j2 = (await res2.json().catch(() => null)) as CommunityPayload | null;
      if (res2.ok && j2?.ok) {
        setMsgs((prev) => mergeUniqueById(prev, (j2.messages ?? []) as any, "append"));
        setNextCursor(j2.nextCursor ?? null);
      }

      // scroll to bottom
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
    } catch (e: any) {
      alert(e?.message ?? "Send failed");
    } finally {
      setSendBusy(false);
    }
  }

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
                {data?.coin?.image ? <img src={data.coin.image} alt="" className="h-full w-full object-cover" /> : null}
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
            <p className="mt-2 text-sm text-zinc-400">
              You can’t view messages until you join.
            </p>

            <button
              onClick={join}
              disabled={joinBusy}
              className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
            >
              {joinBusy ? "Joining…" : "Join community"}
            </button>

            <p className="mt-3 text-xs text-zinc-500">
              Anyone can join. Leaving removes access to messages until you re-join.
            </p>
          </div>
        ) : (
          <>
            {/* Messages */}
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

              <div
                ref={listRef}
                className="h-[520px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3"
              >
                {msgs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                    No messages yet. Say hi 👋
                  </div>
                ) : (
                  <div className="space-y-2">
                    {msgs.map((m) => {
                      const name = (m.author_name || "").trim() || shortAddr(m.author_wallet);
                      return (
                        <div key={m.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-white/10 bg-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {m.author_pfp_url ? (
                                  <img src={m.author_pfp_url} alt="" className="h-full w-full object-cover" />
                                ) : null}
                              </div>

                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{name}</div>
                                <div className="font-mono text-[11px] text-zinc-500">{shortAddr(m.author_wallet)}</div>
                              </div>
                            </div>

                            <div className="shrink-0 text-[11px] text-zinc-500">{fmtTime(m.created_at)}</div>
                          </div>

                          {m.text ? (
                            <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">{m.text}</div>
                          ) : null}

                          {m.image_url ? (
                            <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.image_url} alt="" className="max-h-[420px] w-full object-cover" />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="mt-3 grid gap-2">
                <textarea
                  className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Write a message…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={sendBusy}
                />

                {/* stage later: replace with file upload (private bucket + signed URL) */}
                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Image URL (optional) — we’ll replace this with upload"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  disabled={sendBusy}
                />

                <button
                  onClick={send}
                  disabled={sendBusy || (!text.trim() && !imageUrl.trim())}
                  className="w-full rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                >
                  {sendBusy ? "Sending…" : "Send"}
                </button>

                <p className="text-[11px] text-zinc-500">
                  No “load newer” button — new messages auto-refresh. Use “Load older” to scroll back.
                </p>
              </div>
            </div>

            {/* Footer helpers */}
            {data.coin?.id ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/coin/${encodeURIComponent(data.coin.id)}`}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  Back to coin →
                </Link>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

type CommunityPayload = {
  ok: true;
  community: {
    id: string;
    coin_id: string;
    dev_wallet: string;
    title: string | null;
    created_at: string;
    viewerRole: "dev" | "member" | null; // null = not joined
    membersCount?: number;
  };
  coin?: {
    id: string;
    token_address: string;
    name: string | null;
    symbol: string | null;
    image: string | null;
  } | null;
  messages?: Array<{
    id: string;
    community_id: string;
    author_wallet: string;
    author_name?: string | null; // preferred (dev display_name)
    author_pfp_url?: string | null; // optional
    text: string | null;
    image_url: string | null;
    created_at: string;
  }>;
  nextCursor?: string | null; // for older pagination
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

  // messages + paging
  const [msgs, setMsgs] = useState<NonNullable<CommunityPayload["messages"]>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);

  // post box
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState(""); // (stage later: file upload)
  const [sendBusy, setSendBusy] = useState(false);

  // join/leave
  const [joinBusy, setJoinBusy] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const p = await params;
      setCommunityId(p.id);
    })();
  }, [params]);

  const viewerRole = data?.community?.viewerRole ?? null;
  const isMember = viewerRole === "member" || viewerRole === "dev";

  const headerTitle = useMemo(() => {
    const c = data?.community;
    const coin = data?.coin;
    const t = c?.title || coin?.name || "Community";
    const sym = coin?.symbol ? ` (${coin.symbol})` : "";
    return `${t}${sym}`;
  }, [data?.community, data?.coin]);

  function mergeUniqueById(
    prev: NonNullable<CommunityPayload["messages"]>,
    incoming: NonNullable<CommunityPayload["messages"]>,
    mode: "prepend" | "append"
  ) {
    const map = new Map<string, (typeof prev)[number]>();
    for (const m of prev) map.set(m.id, m);
    for (const m of incoming) map.set(m.id, m);
    const all = Array.from(map.values());
    all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    // mode affects scroll behavior; ordering stays chronological
    return all;
  }

  async function loadInitial() {
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
      const initial = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs(initial);
      setNextCursor(json?.nextCursor ?? null);

      // scroll to bottom after first load if member
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
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

  // Poll for new messages (no "load newer" button)
  useEffect(() => {
    if (!communityId) return;
    if (!isMember) return;

    let alive = true;

    const t = setInterval(async () => {
      if (!alive) return;

      try {
        // simplest: re-fetch latest (API should return latest messages)
        const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, {
          cache: "no-store"
        });
        const json = (await res.json().catch(() => null)) as CommunityPayload | null;
        if (!res.ok || !json?.ok) return;

        const incoming = (json.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
        setMsgs((prev) => mergeUniqueById(prev, incoming, "append"));

        // keep nextCursor updated too (older pagination)
        setNextCursor(json.nextCursor ?? null);
        setData((prev) => (prev ? { ...prev, community: { ...prev.community, viewerRole: json.community.viewerRole } } : json));
      } catch {
        // ignore transient errors
      }
    }, 10_000);

    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, isMember]);

  async function loadOlder() {
    if (!communityId) return;
    if (!nextCursor) return;
    if (olderBusy) return;

    setOlderBusy(true);
    try {
      const res = await fetch(
        `/api/communities/${encodeURIComponent(communityId)}?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as CommunityPayload | null;
      if (!res.ok) throw new Error((json as any)?.error || "Failed to load older messages");

      const incoming = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs((prev) => mergeUniqueById(prev, incoming, "prepend"));
      setNextCursor(json?.nextCursor ?? null);

      // keep scroll stable-ish by nudging a bit
      if (listRef.current) {
        listRef.current.scrollTop = 80;
      }
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
      if (!res.ok) throw new Error(json?.error || "Join failed");
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

  async function send() {
    if (!communityId) return;
    const t = text.trim();
    const img = imageUrl.trim() || null;

    if (!t && !img) return;

    setSendBusy(true);
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t || null, image_url: img })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Send failed");

      setText("");
      setImageUrl("");

      // Refresh latest after sending
      const res2 = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, { cache: "no-store" });
      const j2 = (await res2.json().catch(() => null)) as CommunityPayload | null;
      if (res2.ok && j2?.ok) {
        setMsgs((prev) => mergeUniqueById(prev, (j2.messages ?? []) as any, "append"));
        setNextCursor(j2.nextCursor ?? null);
      }

      // scroll to bottom
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
    } catch (e: any) {
      alert(e?.message ?? "Send failed");
    } finally {
      setSendBusy(false);
    }
  }

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
                {data?.coin?.image ? <img src={data.coin.image} alt="" className="h-full w-full object-cover" /> : null}
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
            <p className="mt-2 text-sm text-zinc-400">
              You can’t view messages until you join.
            </p>

            <button
              onClick={join}
              disabled={joinBusy}
              className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
            >
              {joinBusy ? "Joining…" : "Join community"}
            </button>

            <p className="mt-3 text-xs text-zinc-500">
              Anyone can join. Leaving removes access to messages until you re-join.
            </p>
          </div>
        ) : (
          <>
            {/* Messages */}
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

              <div
                ref={listRef}
                className="h-[520px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3"
              >
                {msgs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                    No messages yet. Say hi 👋
                  </div>
                ) : (
                  <div className="space-y-2">
                    {msgs.map((m) => {
                      const name = (m.author_name || "").trim() || shortAddr(m.author_wallet);
                      return (
                        <div key={m.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-white/10 bg-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {m.author_pfp_url ? (
                                  <img src={m.author_pfp_url} alt="" className="h-full w-full object-cover" />
                                ) : null}
                              </div>

                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{name}</div>
                                <div className="font-mono text-[11px] text-zinc-500">{shortAddr(m.author_wallet)}</div>
                              </div>
                            </div>

                            <div className="shrink-0 text-[11px] text-zinc-500">{fmtTime(m.created_at)}</div>
                          </div>

                          {m.text ? (
                            <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">{m.text}</div>
                          ) : null}

                          {m.image_url ? (
                            <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.image_url} alt="" className="max-h-[420px] w-full object-cover" />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="mt-3 grid gap-2">
                <textarea
                  className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Write a message…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={sendBusy}
                />

                {/* stage later: replace with file upload (private bucket + signed URL) */}
                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Image URL (optional) — we’ll replace this with upload"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  disabled={sendBusy}
                />

                <button
                  onClick={send}
                  disabled={sendBusy || (!text.trim() && !imageUrl.trim())}
                  className="w-full rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                >
                  {sendBusy ? "Sending…" : "Send"}
                </button>

                <p className="text-[11px] text-zinc-500">
                  No “load newer” button — new messages auto-refresh. Use “Load older” to scroll back.
                </p>
              </div>
            </div>

            {/* Footer helpers */}
            {data.coin?.id ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/coin/${encodeURIComponent(data.coin.id)}`}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  Back to coin →
                </Link>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

type CommunityPayload = {
  ok: true;
  community: {
    id: string;
    coin_id: string;
    dev_wallet: string;
    title: string | null;
    created_at: string;
    viewerRole: "dev" | "member" | null; // null = not joined
    membersCount?: number;
  };
  coin?: {
    id: string;
    token_address: string;
    name: string | null;
    symbol: string | null;
    image: string | null;
  } | null;
  messages?: Array<{
    id: string;
    community_id: string;
    author_wallet: string;
    author_name?: string | null; // preferred (dev display_name)
    author_pfp_url?: string | null; // optional
    text: string | null;
    image_url: string | null;
    created_at: string;
  }>;
  nextCursor?: string | null; // for older pagination
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

  // messages + paging
  const [msgs, setMsgs] = useState<NonNullable<CommunityPayload["messages"]>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);

  // post box
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState(""); // (stage later: file upload)
  const [sendBusy, setSendBusy] = useState(false);

  // join/leave
  const [joinBusy, setJoinBusy] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const p = await params;
      setCommunityId(p.id);
    })();
  }, [params]);

  const viewerRole = data?.community?.viewerRole ?? null;
  const isMember = viewerRole === "member" || viewerRole === "dev";

  const headerTitle = useMemo(() => {
    const c = data?.community;
    const coin = data?.coin;
    const t = c?.title || coin?.name || "Community";
    const sym = coin?.symbol ? ` (${coin.symbol})` : "";
    return `${t}${sym}`;
  }, [data?.community, data?.coin]);

  function mergeUniqueById(
    prev: NonNullable<CommunityPayload["messages"]>,
    incoming: NonNullable<CommunityPayload["messages"]>,
    mode: "prepend" | "append"
  ) {
    const map = new Map<string, (typeof prev)[number]>();
    for (const m of prev) map.set(m.id, m);
    for (const m of incoming) map.set(m.id, m);
    const all = Array.from(map.values());
    all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    // mode affects scroll behavior; ordering stays chronological
    return all;
  }

  async function loadInitial() {
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
      const initial = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs(initial);
      setNextCursor(json?.nextCursor ?? null);

      // scroll to bottom after first load if member
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
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

  // Poll for new messages (no "load newer" button)
  useEffect(() => {
    if (!communityId) return;
    if (!isMember) return;

    let alive = true;

    const t = setInterval(async () => {
      if (!alive) return;

      try {
        // simplest: re-fetch latest (API should return latest messages)
        const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, {
          cache: "no-store"
        });
        const json = (await res.json().catch(() => null)) as CommunityPayload | null;
        if (!res.ok || !json?.ok) return;

        const incoming = (json.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
        setMsgs((prev) => mergeUniqueById(prev, incoming, "append"));

        // keep nextCursor updated too (older pagination)
        setNextCursor(json.nextCursor ?? null);
        setData((prev) => (prev ? { ...prev, community: { ...prev.community, viewerRole: json.community.viewerRole } } : json));
      } catch {
        // ignore transient errors
      }
    }, 10_000);

    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, isMember]);

  async function loadOlder() {
    if (!communityId) return;
    if (!nextCursor) return;
    if (olderBusy) return;

    setOlderBusy(true);
    try {
      const res = await fetch(
        `/api/communities/${encodeURIComponent(communityId)}?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as CommunityPayload | null;
      if (!res.ok) throw new Error((json as any)?.error || "Failed to load older messages");

      const incoming = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs((prev) => mergeUniqueById(prev, incoming, "prepend"));
      setNextCursor(json?.nextCursor ?? null);

      // keep scroll stable-ish by nudging a bit
      if (listRef.current) {
        listRef.current.scrollTop = 80;
      }
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
      if (!res.ok) throw new Error(json?.error || "Join failed");
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

  async function send() {
    if (!communityId) return;
    const t = text.trim();
    const img = imageUrl.trim() || null;

    if (!t && !img) return;

    setSendBusy(true);
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t || null, image_url: img })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Send failed");

      setText("");
      setImageUrl("");

      // Refresh latest after sending
      const res2 = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, { cache: "no-store" });
      const j2 = (await res2.json().catch(() => null)) as CommunityPayload | null;
      if (res2.ok && j2?.ok) {
        setMsgs((prev) => mergeUniqueById(prev, (j2.messages ?? []) as any, "append"));
        setNextCursor(j2.nextCursor ?? null);
      }

      // scroll to bottom
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
    } catch (e: any) {
      alert(e?.message ?? "Send failed");
    } finally {
      setSendBusy(false);
    }
  }

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
                {data?.coin?.image ? <img src={data.coin.image} alt="" className="h-full w-full object-cover" /> : null}
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
            <p className="mt-2 text-sm text-zinc-400">
              You can’t view messages until you join.
            </p>

            <button
              onClick={join}
              disabled={joinBusy}
              className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
            >
              {joinBusy ? "Joining…" : "Join community"}
            </button>

            <p className="mt-3 text-xs text-zinc-500">
              Anyone can join. Leaving removes access to messages until you re-join.
            </p>
          </div>
        ) : (
          <>
            {/* Messages */}
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

              <div
                ref={listRef}
                className="h-[520px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3"
              >
                {msgs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                    No messages yet. Say hi 👋
                  </div>
                ) : (
                  <div className="space-y-2">
                    {msgs.map((m) => {
                      const name = (m.author_name || "").trim() || shortAddr(m.author_wallet);
                      return (
                        <div key={m.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-white/10 bg-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {m.author_pfp_url ? (
                                  <img src={m.author_pfp_url} alt="" className="h-full w-full object-cover" />
                                ) : null}
                              </div>

                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{name}</div>
                                <div className="font-mono text-[11px] text-zinc-500">{shortAddr(m.author_wallet)}</div>
                              </div>
                            </div>

                            <div className="shrink-0 text-[11px] text-zinc-500">{fmtTime(m.created_at)}</div>
                          </div>

                          {m.text ? (
                            <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">{m.text}</div>
                          ) : null}

                          {m.image_url ? (
                            <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.image_url} alt="" className="max-h-[420px] w-full object-cover" />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="mt-3 grid gap-2">
                <textarea
                  className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Write a message…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={sendBusy}
                />

                {/* stage later: replace with file upload (private bucket + signed URL) */}
                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Image URL (optional) — we’ll replace this with upload"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  disabled={sendBusy}
                />

                <button
                  onClick={send}
                  disabled={sendBusy || (!text.trim() && !imageUrl.trim())}
                  className="w-full rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                >
                  {sendBusy ? "Sending…" : "Send"}
                </button>

                <p className="text-[11px] text-zinc-500">
                  No “load newer” button — new messages auto-refresh. Use “Load older” to scroll back.
                </p>
              </div>
            </div>

            {/* Footer helpers */}
            {data.coin?.id ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/coin/${encodeURIComponent(data.coin.id)}`}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  Back to coin →
                </Link>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

type CommunityPayload = {
  ok: true;
  community: {
    id: string;
    coin_id: string;
    dev_wallet: string;
    title: string | null;
    created_at: string;
    viewerRole: "dev" | "member" | null; // null = not joined
    membersCount?: number;
  };
  coin?: {
    id: string;
    token_address: string;
    name: string | null;
    symbol: string | null;
    image: string | null;
  } | null;
  messages?: Array<{
    id: string;
    community_id: string;
    author_wallet: string;
    author_name?: string | null; // preferred (dev display_name)
    author_pfp_url?: string | null; // optional
    text: string | null;
    image_url: string | null;
    created_at: string;
  }>;
  nextCursor?: string | null; // for older pagination
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

  // messages + paging
  const [msgs, setMsgs] = useState<NonNullable<CommunityPayload["messages"]>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);

  // post box
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState(""); // (stage later: file upload)
  const [sendBusy, setSendBusy] = useState(false);

  // join/leave
  const [joinBusy, setJoinBusy] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const p = await params;
      setCommunityId(p.id);
    })();
  }, [params]);

  const viewerRole = data?.community?.viewerRole ?? null;
  const isMember = viewerRole === "member" || viewerRole === "dev";

  const headerTitle = useMemo(() => {
    const c = data?.community;
    const coin = data?.coin;
    const t = c?.title || coin?.name || "Community";
    const sym = coin?.symbol ? ` (${coin.symbol})` : "";
    return `${t}${sym}`;
  }, [data?.community, data?.coin]);

  function mergeUniqueById(
    prev: NonNullable<CommunityPayload["messages"]>,
    incoming: NonNullable<CommunityPayload["messages"]>,
    mode: "prepend" | "append"
  ) {
    const map = new Map<string, (typeof prev)[number]>();
    for (const m of prev) map.set(m.id, m);
    for (const m of incoming) map.set(m.id, m);
    const all = Array.from(map.values());
    all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    // mode affects scroll behavior; ordering stays chronological
    return all;
  }

  async function loadInitial() {
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
      const initial = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs(initial);
      setNextCursor(json?.nextCursor ?? null);

      // scroll to bottom after first load if member
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
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

  // Poll for new messages (no "load newer" button)
  useEffect(() => {
    if (!communityId) return;
    if (!isMember) return;

    let alive = true;

    const t = setInterval(async () => {
      if (!alive) return;

      try {
        // simplest: re-fetch latest (API should return latest messages)
        const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, {
          cache: "no-store"
        });
        const json = (await res.json().catch(() => null)) as CommunityPayload | null;
        if (!res.ok || !json?.ok) return;

        const incoming = (json.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
        setMsgs((prev) => mergeUniqueById(prev, incoming, "append"));

        // keep nextCursor updated too (older pagination)
        setNextCursor(json.nextCursor ?? null);
        setData((prev) => (prev ? { ...prev, community: { ...prev.community, viewerRole: json.community.viewerRole } } : json));
      } catch {
        // ignore transient errors
      }
    }, 10_000);

    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, isMember]);

  async function loadOlder() {
    if (!communityId) return;
    if (!nextCursor) return;
    if (olderBusy) return;

    setOlderBusy(true);
    try {
      const res = await fetch(
        `/api/communities/${encodeURIComponent(communityId)}?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as CommunityPayload | null;
      if (!res.ok) throw new Error((json as any)?.error || "Failed to load older messages");

      const incoming = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs((prev) => mergeUniqueById(prev, incoming, "prepend"));
      setNextCursor(json?.nextCursor ?? null);

      // keep scroll stable-ish by nudging a bit
      if (listRef.current) {
        listRef.current.scrollTop = 80;
      }
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
      if (!res.ok) throw new Error(json?.error || "Join failed");
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

  async function send() {
    if (!communityId) return;
    const t = text.trim();
    const img = imageUrl.trim() || null;

    if (!t && !img) return;

    setSendBusy(true);
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t || null, image_url: img })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Send failed");

      setText("");
      setImageUrl("");

      // Refresh latest after sending
      const res2 = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, { cache: "no-store" });
      const j2 = (await res2.json().catch(() => null)) as CommunityPayload | null;
      if (res2.ok && j2?.ok) {
        setMsgs((prev) => mergeUniqueById(prev, (j2.messages ?? []) as any, "append"));
        setNextCursor(j2.nextCursor ?? null);
      }

      // scroll to bottom
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
    } catch (e: any) {
      alert(e?.message ?? "Send failed");
    } finally {
      setSendBusy(false);
    }
  }

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
                {data?.coin?.image ? <img src={data.coin.image} alt="" className="h-full w-full object-cover" /> : null}
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
            <p className="mt-2 text-sm text-zinc-400">
              You can’t view messages until you join.
            </p>

            <button
              onClick={join}
              disabled={joinBusy}
              className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
            >
              {joinBusy ? "Joining…" : "Join community"}
            </button>

            <p className="mt-3 text-xs text-zinc-500">
              Anyone can join. Leaving removes access to messages until you re-join.
            </p>
          </div>
        ) : (
          <>
            {/* Messages */}
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

              <div
                ref={listRef}
                className="h-[520px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3"
              >
                {msgs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                    No messages yet. Say hi 👋
                  </div>
                ) : (
                  <div className="space-y-2">
                    {msgs.map((m) => {
                      const name = (m.author_name || "").trim() || shortAddr(m.author_wallet);
                      return (
                        <div key={m.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-white/10 bg-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {m.author_pfp_url ? (
                                  <img src={m.author_pfp_url} alt="" className="h-full w-full object-cover" />
                                ) : null}
                              </div>

                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{name}</div>
                                <div className="font-mono text-[11px] text-zinc-500">{shortAddr(m.author_wallet)}</div>
                              </div>
                            </div>

                            <div className="shrink-0 text-[11px] text-zinc-500">{fmtTime(m.created_at)}</div>
                          </div>

                          {m.text ? (
                            <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">{m.text}</div>
                          ) : null}

                          {m.image_url ? (
                            <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.image_url} alt="" className="max-h-[420px] w-full object-cover" />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="mt-3 grid gap-2">
                <textarea
                  className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Write a message…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={sendBusy}
                />

                {/* stage later: replace with file upload (private bucket + signed URL) */}
                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Image URL (optional) — we’ll replace this with upload"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  disabled={sendBusy}
                />

                <button
                  onClick={send}
                  disabled={sendBusy || (!text.trim() && !imageUrl.trim())}
                  className="w-full rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                >
                  {sendBusy ? "Sending…" : "Send"}
                </button>

                <p className="text-[11px] text-zinc-500">
                  No “load newer” button — new messages auto-refresh. Use “Load older” to scroll back.
                </p>
              </div>
            </div>

            {/* Footer helpers */}
            {data.coin?.id ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/coin/${encodeURIComponent(data.coin.id)}`}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  Back to coin →
                </Link>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

type CommunityPayload = {
  ok: true;
  community: {
    id: string;
    coin_id: string;
    dev_wallet: string;
    title: string | null;
    created_at: string;
    viewerRole: "dev" | "member" | null; // null = not joined
    membersCount?: number;
  };
  coin?: {
    id: string;
    token_address: string;
    name: string | null;
    symbol: string | null;
    image: string | null;
  } | null;
  messages?: Array<{
    id: string;
    community_id: string;
    author_wallet: string;
    author_name?: string | null; // preferred (dev display_name)
    author_pfp_url?: string | null; // optional
    text: string | null;
    image_url: string | null;
    created_at: string;
  }>;
  nextCursor?: string | null; // for older pagination
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

  // messages + paging
  const [msgs, setMsgs] = useState<NonNullable<CommunityPayload["messages"]>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);

  // post box
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState(""); // (stage later: file upload)
  const [sendBusy, setSendBusy] = useState(false);

  // join/leave
  const [joinBusy, setJoinBusy] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const p = await params;
      setCommunityId(p.id);
    })();
  }, [params]);

  const viewerRole = data?.community?.viewerRole ?? null;
  const isMember = viewerRole === "member" || viewerRole === "dev";

  const headerTitle = useMemo(() => {
    const c = data?.community;
    const coin = data?.coin;
    const t = c?.title || coin?.name || "Community";
    const sym = coin?.symbol ? ` (${coin.symbol})` : "";
    return `${t}${sym}`;
  }, [data?.community, data?.coin]);

  function mergeUniqueById(
    prev: NonNullable<CommunityPayload["messages"]>,
    incoming: NonNullable<CommunityPayload["messages"]>,
    mode: "prepend" | "append"
  ) {
    const map = new Map<string, (typeof prev)[number]>();
    for (const m of prev) map.set(m.id, m);
    for (const m of incoming) map.set(m.id, m);
    const all = Array.from(map.values());
    all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    // mode affects scroll behavior; ordering stays chronological
    return all;
  }

  async function loadInitial() {
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
      const initial = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs(initial);
      setNextCursor(json?.nextCursor ?? null);

      // scroll to bottom after first load if member
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
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

  // Poll for new messages (no "load newer" button)
  useEffect(() => {
    if (!communityId) return;
    if (!isMember) return;

    let alive = true;

    const t = setInterval(async () => {
      if (!alive) return;

      try {
        // simplest: re-fetch latest (API should return latest messages)
        const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, {
          cache: "no-store"
        });
        const json = (await res.json().catch(() => null)) as CommunityPayload | null;
        if (!res.ok || !json?.ok) return;

        const incoming = (json.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
        setMsgs((prev) => mergeUniqueById(prev, incoming, "append"));

        // keep nextCursor updated too (older pagination)
        setNextCursor(json.nextCursor ?? null);
        setData((prev) => (prev ? { ...prev, community: { ...prev.community, viewerRole: json.community.viewerRole } } : json));
      } catch {
        // ignore transient errors
      }
    }, 10_000);

    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, isMember]);

  async function loadOlder() {
    if (!communityId) return;
    if (!nextCursor) return;
    if (olderBusy) return;

    setOlderBusy(true);
    try {
      const res = await fetch(
        `/api/communities/${encodeURIComponent(communityId)}?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as CommunityPayload | null;
      if (!res.ok) throw new Error((json as any)?.error || "Failed to load older messages");

      const incoming = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs((prev) => mergeUniqueById(prev, incoming, "prepend"));
      setNextCursor(json?.nextCursor ?? null);

      // keep scroll stable-ish by nudging a bit
      if (listRef.current) {
        listRef.current.scrollTop = 80;
      }
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
      if (!res.ok) throw new Error(json?.error || "Join failed");
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

  async function send() {
    if (!communityId) return;
    const t = text.trim();
    const img = imageUrl.trim() || null;

    if (!t && !img) return;

    setSendBusy(true);
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t || null, image_url: img })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Send failed");

      setText("");
      setImageUrl("");

      // Refresh latest after sending
      const res2 = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, { cache: "no-store" });
      const j2 = (await res2.json().catch(() => null)) as CommunityPayload | null;
      if (res2.ok && j2?.ok) {
        setMsgs((prev) => mergeUniqueById(prev, (j2.messages ?? []) as any, "append"));
        setNextCursor(j2.nextCursor ?? null);
      }

      // scroll to bottom
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
    } catch (e: any) {
      alert(e?.message ?? "Send failed");
    } finally {
      setSendBusy(false);
    }
  }

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
                {data?.coin?.image ? <img src={data.coin.image} alt="" className="h-full w-full object-cover" /> : null}
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
            <p className="mt-2 text-sm text-zinc-400">
              You can’t view messages until you join.
            </p>

            <button
              onClick={join}
              disabled={joinBusy}
              className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
            >
              {joinBusy ? "Joining…" : "Join community"}
            </button>

            <p className="mt-3 text-xs text-zinc-500">
              Anyone can join. Leaving removes access to messages until you re-join.
            </p>
          </div>
        ) : (
          <>
            {/* Messages */}
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

              <div
                ref={listRef}
                className="h-[520px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3"
              >
                {msgs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                    No messages yet. Say hi 👋
                  </div>
                ) : (
                  <div className="space-y-2">
                    {msgs.map((m) => {
                      const name = (m.author_name || "").trim() || shortAddr(m.author_wallet);
                      return (
                        <div key={m.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-white/10 bg-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {m.author_pfp_url ? (
                                  <img src={m.author_pfp_url} alt="" className="h-full w-full object-cover" />
                                ) : null}
                              </div>

                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{name}</div>
                                <div className="font-mono text-[11px] text-zinc-500">{shortAddr(m.author_wallet)}</div>
                              </div>
                            </div>

                            <div className="shrink-0 text-[11px] text-zinc-500">{fmtTime(m.created_at)}</div>
                          </div>

                          {m.text ? (
                            <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">{m.text}</div>
                          ) : null}

                          {m.image_url ? (
                            <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.image_url} alt="" className="max-h-[420px] w-full object-cover" />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="mt-3 grid gap-2">
                <textarea
                  className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Write a message…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={sendBusy}
                />

                {/* stage later: replace with file upload (private bucket + signed URL) */}
                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Image URL (optional) — we’ll replace this with upload"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  disabled={sendBusy}
                />

                <button
                  onClick={send}
                  disabled={sendBusy || (!text.trim() && !imageUrl.trim())}
                  className="w-full rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                >
                  {sendBusy ? "Sending…" : "Send"}
                </button>

                <p className="text-[11px] text-zinc-500">
                  No “load newer” button — new messages auto-refresh. Use “Load older” to scroll back.
                </p>
              </div>
            </div>

            {/* Footer helpers */}
            {data.coin?.id ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/coin/${encodeURIComponent(data.coin.id)}`}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  Back to coin →
                </Link>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

type CommunityPayload = {
  ok: true;
  community: {
    id: string;
    coin_id: string;
    dev_wallet: string;
    title: string | null;
    created_at: string;
    viewerRole: "dev" | "member" | null; // null = not joined
    membersCount?: number;
  };
  coin?: {
    id: string;
    token_address: string;
    name: string | null;
    symbol: string | null;
    image: string | null;
  } | null;
  messages?: Array<{
    id: string;
    community_id: string;
    author_wallet: string;
    author_name?: string | null; // preferred (dev display_name)
    author_pfp_url?: string | null; // optional
    text: string | null;
    image_url: string | null;
    created_at: string;
  }>;
  nextCursor?: string | null; // for older pagination
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

  // messages + paging
  const [msgs, setMsgs] = useState<NonNullable<CommunityPayload["messages"]>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);

  // post box
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState(""); // (stage later: file upload)
  const [sendBusy, setSendBusy] = useState(false);

  // join/leave
  const [joinBusy, setJoinBusy] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const p = await params;
      setCommunityId(p.id);
    })();
  }, [params]);

  const viewerRole = data?.community?.viewerRole ?? null;
  const isMember = viewerRole === "member" || viewerRole === "dev";

  const headerTitle = useMemo(() => {
    const c = data?.community;
    const coin = data?.coin;
    const t = c?.title || coin?.name || "Community";
    const sym = coin?.symbol ? ` (${coin.symbol})` : "";
    return `${t}${sym}`;
  }, [data?.community, data?.coin]);

  function mergeUniqueById(
    prev: NonNullable<CommunityPayload["messages"]>,
    incoming: NonNullable<CommunityPayload["messages"]>,
    mode: "prepend" | "append"
  ) {
    const map = new Map<string, (typeof prev)[number]>();
    for (const m of prev) map.set(m.id, m);
    for (const m of incoming) map.set(m.id, m);
    const all = Array.from(map.values());
    all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    // mode affects scroll behavior; ordering stays chronological
    return all;
  }

  async function loadInitial() {
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
      const initial = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs(initial);
      setNextCursor(json?.nextCursor ?? null);

      // scroll to bottom after first load if member
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
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

  // Poll for new messages (no "load newer" button)
  useEffect(() => {
    if (!communityId) return;
    if (!isMember) return;

    let alive = true;

    const t = setInterval(async () => {
      if (!alive) return;

      try {
        // simplest: re-fetch latest (API should return latest messages)
        const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, {
          cache: "no-store"
        });
        const json = (await res.json().catch(() => null)) as CommunityPayload | null;
        if (!res.ok || !json?.ok) return;

        const incoming = (json.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
        setMsgs((prev) => mergeUniqueById(prev, incoming, "append"));

        // keep nextCursor updated too (older pagination)
        setNextCursor(json.nextCursor ?? null);
        setData((prev) => (prev ? { ...prev, community: { ...prev.community, viewerRole: json.community.viewerRole } } : json));
      } catch {
        // ignore transient errors
      }
    }, 10_000);

    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, isMember]);

  async function loadOlder() {
    if (!communityId) return;
    if (!nextCursor) return;
    if (olderBusy) return;

    setOlderBusy(true);
    try {
      const res = await fetch(
        `/api/communities/${encodeURIComponent(communityId)}?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as CommunityPayload | null;
      if (!res.ok) throw new Error((json as any)?.error || "Failed to load older messages");

      const incoming = (json?.messages ?? []) as NonNullable<CommunityPayload["messages"]>;
      setMsgs((prev) => mergeUniqueById(prev, incoming, "prepend"));
      setNextCursor(json?.nextCursor ?? null);

      // keep scroll stable-ish by nudging a bit
      if (listRef.current) {
        listRef.current.scrollTop = 80;
      }
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
      if (!res.ok) throw new Error(json?.error || "Join failed");
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

  async function send() {
    if (!communityId) return;
    const t = text.trim();
    const img = imageUrl.trim() || null;

    if (!t && !img) return;

    setSendBusy(true);
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t || null, image_url: img })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Send failed");

      setText("");
      setImageUrl("");

      // Refresh latest after sending
      const res2 = await fetch(`/api/communities/${encodeURIComponent(communityId)}`, { cache: "no-store" });
      const j2 = (await res2.json().catch(() => null)) as CommunityPayload | null;
      if (res2.ok && j2?.ok) {
        setMsgs((prev) => mergeUniqueById(prev, (j2.messages ?? []) as any, "append"));
        setNextCursor(j2.nextCursor ?? null);
      }

      // scroll to bottom
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      }, 50);
    } catch (e: any) {
      alert(e?.message ?? "Send failed");
    } finally {
      setSendBusy(false);
    }
  }

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
                {data?.coin?.image ? <img src={data.coin.image} alt="" className="h-full w-full object-cover" /> : null}
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
            <p className="mt-2 text-sm text-zinc-400">
              You can’t view messages until you join.
            </p>

            <button
              onClick={join}
              disabled={joinBusy}
              className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
            >
              {joinBusy ? "Joining…" : "Join community"}
            </button>

            <p className="mt-3 text-xs text-zinc-500">
              Anyone can join. Leaving removes access to messages until you re-join.
            </p>
          </div>
        ) : (
          <>
            {/* Messages */}
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

              <div
                ref={listRef}
                className="h-[520px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3"
              >
                {msgs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                    No messages yet. Say hi 👋
                  </div>
                ) : (
                  <div className="space-y-2">
                    {msgs.map((m) => {
                      const name = (m.author_name || "").trim() || shortAddr(m.author_wallet);
                      return (
                        <div key={m.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="h-8 w-8 overflow-hidden rounded-full border border-white/10 bg-white/5">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {m.author_pfp_url ? (
                                  <img src={m.author_pfp_url} alt="" className="h-full w-full object-cover" />
                                ) : null}
                              </div>

                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{name}</div>
                                <div className="font-mono text-[11px] text-zinc-500">{shortAddr(m.author_wallet)}</div>
                              </div>
                            </div>

                            <div className="shrink-0 text-[11px] text-zinc-500">{fmtTime(m.created_at)}</div>
                          </div>

                          {m.text ? (
                            <div className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">{m.text}</div>
                          ) : null}

                          {m.image_url ? (
                            <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.image_url} alt="" className="max-h-[420px] w-full object-cover" />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="mt-3 grid gap-2">
                <textarea
                  className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Write a message…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={sendBusy}
                />

                {/* stage later: replace with file upload (private bucket + signed URL) */}
                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Image URL (optional) — we’ll replace this with upload"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  disabled={sendBusy}
                />

                <button
                  onClick={send}
                  disabled={sendBusy || (!text.trim() && !imageUrl.trim())}
                  className="w-full rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                >
                  {sendBusy ? "Sending…" : "Send"}
                </button>

                <p className="text-[11px] text-zinc-500">
                  No “load newer” button — new messages auto-refresh. Use “Load older” to scroll back.
                </p>
              </div>
            </div>

            {/* Footer helpers */}
            {data.coin?.id ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/coin/${encodeURIComponent(data.coin.id)}`}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                >
                  Back to coin →
                </Link>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
