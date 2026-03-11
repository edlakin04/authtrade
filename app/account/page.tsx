"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import TopNav from "@/components/TopNav";

// ─── Types ────────────────────────────────────────────────────────────────────

type Portfolio = {
  ok: true;
  owner: string;
  sol: number;
  solUsd: number | null;
  solUsdValue: number | null;
  totalUsd: number | null;
  tokens: Array<{
    mint: string;
    uiAmount: number;
    decimals: number;
    usdPrice: number | null;
    usdValue: number | null;
  }>;
};

type MyCommunitiesPayload = {
  ok: true;
  communities: Array<{
    id: string;
    coin_id: string;
    dev_wallet: string;
    title: string | null;
    created_at: string;
    viewerRole?: "dev" | "member";
  }>;
};

type FollowingFeedPayload = {
  error?: string;
  devWallets?: string[];
  posts?: any[];
  coins?: any[];
};

type MyProfilePayload = {
  ok: true;
  profile: {
    wallet: string;
    display_name: string;
    pfp_path: string | null;
    pfp_url: string | null;
  };
};

type DevBatchPayload = {
  ok: true;
  profiles: Array<{
    wallet: string;
    display_name: string | null;
    pfp_url: string | null;
  }>;
};

type Notification = {
  id: string;
  actor_wallet: string;
  type: "new_post" | "new_coin";
  title: string;
  body: string | null;
  link: string;
  seen: boolean;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WSOL_MINT = "So11111111111111111111111111111111111111112";

function shortAddr(m: string) {
  if (!m) return "";
  return `${m.slice(0, 4)}…${m.slice(-4)}`;
}

function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

function fmtAmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Tab types ────────────────────────────────────────────────────────────────

type TabKey = "wallet" | "communities" | "following" | "notifications" | "profile";

// ─── Main component ───────────────────────────────────────────────────────────

export default function AccountPage() {
  const { publicKey, connected } = useWallet();
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>("wallet");
  const [isDev, setIsDev] = useState<boolean | null>(null);

  // Wallet/portfolio state
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Portfolio | null>(null);

  // Communities state
  const [commLoading, setCommLoading] = useState(false);
  const [commErr, setCommErr] = useState<string | null>(null);
  const [communities, setCommunities] = useState<MyCommunitiesPayload["communities"]>([]);
  const [commTab, setCommTab] = useState<"all" | "mine">("all");

  // Following state
  const [followLoading, setFollowLoading] = useState(false);
  const [followErr, setFollowErr] = useState<string | null>(null);
  const [following, setFollowing] = useState<string[]>([]);
  const [followMetaByWallet, setFollowMetaByWallet] = useState<
    Record<string, { name: string | null; pfpUrl: string | null }>
  >({});

  // Notifications state
  const [notiLoading, setNotiLoading] = useState(false);
  const [notiErr, setNotiErr] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unseenCount, setUnseenCount] = useState(0);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  // Profile state
  const [profLoading, setProfLoading] = useState(false);
  const [profErr, setProfErr] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [pfpSignedUrl, setPfpSignedUrl] = useState<string | null>(null);
  const [pfpFile, setPfpFile] = useState<File | null>(null);
  const [pfpUploading, setPfpUploading] = useState(false);
  const [profSaving, setProfSaving] = useState(false);

  const owner = useMemo(() => publicKey?.toBase58() ?? "", [publicKey]);

  // ── Detect dev role ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dev/profile", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) setIsDev(true);
        else setIsDev(false);
      } catch {
        if (!cancelled) setIsDev(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Bounce devs off Profile tab ──────────────────────────────────────────────
  useEffect(() => {
    if (isDev && tab === "profile") setTab("wallet");
  }, [isDev, tab]);

  // ── Portfolio load ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!connected || !owner) { setData(null); setErr(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const res = await fetch(`/api/portfolio?owner=${encodeURIComponent(owner)}`, { cache: "no-store" });
        const text = await res.text();
        let json: any = null;
        try { json = JSON.parse(text); } catch {
          throw new Error(`Portfolio API returned non-JSON: ${text.slice(0, 120)}...`);
        }
        if (!res.ok) throw new Error(json?.details || json?.error || "Failed to load portfolio");
        if (!cancelled) setData(json as Portfolio);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load portfolio");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [connected, owner]);

  // ── Communities load ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== "communities") return;
    let cancelled = false;
    (async () => {
      setCommLoading(true); setCommErr(null);
      try {
        const res = await fetch("/api/communities/me", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || "Failed to load communities");
        if (!cancelled) setCommunities((json?.communities ?? []) as MyCommunitiesPayload["communities"]);
      } catch (e: any) {
        if (!cancelled) { setCommErr(e?.message ?? "Failed to load communities"); setCommunities([]); }
      } finally {
        if (!cancelled) setCommLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  // ── Following load ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== "following") return;
    let cancelled = false;
    (async () => {
      setFollowLoading(true); setFollowErr(null);
      try {
        const res = await fetch("/api/following/feed", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as FollowingFeedPayload | null;
        if (!res.ok) throw new Error((json as any)?.error || "Failed to load following");
        const wallets = (json?.devWallets ?? []) as string[];
        if (!cancelled) setFollowing(wallets);
        const res2 = await fetch("/api/public/dev/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallets })
        });
        const json2 = (await res2.json().catch(() => null)) as DevBatchPayload | any;
        if (!res2.ok) {
          if (!cancelled) setFollowMetaByWallet({});
        } else {
          const map: Record<string, { name: string | null; pfpUrl: string | null }> = {};
          for (const p of (json2?.profiles ?? []) as DevBatchPayload["profiles"]) {
            map[p.wallet] = { name: p.display_name ?? null, pfpUrl: p.pfp_url ?? null };
          }
          if (!cancelled) setFollowMetaByWallet(map);
        }
      } catch (e: any) {
        if (!cancelled) { setFollowErr(e?.message ?? "Failed to load following"); setFollowing([]); setFollowMetaByWallet({}); }
      } finally {
        if (!cancelled) setFollowLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  // ── Notifications load + mark all seen ───────────────────────────────────────
  useEffect(() => {
    if (tab !== "notifications") return;
    let cancelled = false;
    (async () => {
      setNotiLoading(true); setNotiErr(null);
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error || "Failed to load notifications");
        if (!cancelled) {
          setNotifications(json?.notifications ?? []);
          setUnseenCount(0);
        }
        // Mark all seen in background — clears the red dot
        fetch("/api/notifications", { method: "PATCH" }).catch(() => null);
      } catch (e: any) {
        if (!cancelled) { setNotiErr(e?.message ?? "Failed to load notifications"); setNotifications([]); }
      } finally {
        if (!cancelled) setNotiLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  // ── Fetch unseen count on mount (for the tab red dot before opening) ─────────
  useEffect(() => {
    fetch("/api/notifications", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.unseenCount != null) setUnseenCount(d.unseenCount); })
      .catch(() => null);
  }, []);

  // ── Profile load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== "profile" || isDev) return;
    let cancelled = false;
    (async () => {
      setProfLoading(true); setProfErr(null);
      try {
        const res = await fetch("/api/me/profile", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as MyProfilePayload | any;
        if (!res.ok) throw new Error(json?.error || "Failed to load profile");
        if (!cancelled) { setDisplayName(json?.profile?.display_name ?? ""); setPfpSignedUrl(json?.profile?.pfp_url ?? null); }
      } catch (e: any) {
        if (!cancelled) { setProfErr(e?.message ?? "Failed to load profile"); setDisplayName(""); setPfpSignedUrl(null); }
      } finally {
        if (!cancelled) setProfLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, isDev]);

  // ── Token rows ───────────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    if (!data) return [];
    const solRow = { key: "SOL", name: "SOL", mint: WSOL_MINT, amount: data.sol, usdValue: data.solUsdValue, usdPrice: data.solUsd };
    const tokenRows = (data.tokens || []).map((t) => ({ key: t.mint, name: shortAddr(t.mint), mint: t.mint, amount: t.uiAmount, usdValue: t.usdValue, usdPrice: t.usdPrice }));
    return [solRow, ...tokenRows];
  }, [data]);

  // ── Local pfp preview ────────────────────────────────────────────────────────
  const localPreview = useMemo(() => { if (!pfpFile) return null; return URL.createObjectURL(pfpFile); }, [pfpFile]);
  useEffect(() => { return () => { if (localPreview) URL.revokeObjectURL(localPreview); }; }, [localPreview]);

  // ── Notification actions ─────────────────────────────────────────────────────
  const clearOne = useCallback(async (id: string) => {
    setClearingId(id);
    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch { /* silent */ } finally {
      setClearingId(null);
    }
  }, []);

  const clearAll = useCallback(async () => {
    setClearingAll(true);
    try {
      await fetch("/api/notifications", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      setNotifications([]);
    } catch { /* silent */ } finally {
      setClearingAll(false);
    }
  }, []);

  // ── Profile save / upload ────────────────────────────────────────────────────
  async function saveProfile() {
    setProfSaving(true);
    try {
      const res = await fetch("/api/me/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ display_name: displayName }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      alert("Saved.");
    } catch (e: any) { alert(e?.message ?? "Save failed"); } finally { setProfSaving(false); }
  }

  async function uploadPfp() {
    if (!pfpFile) return;
    setPfpUploading(true);
    try {
      const fd = new FormData(); fd.append("file", pfpFile);
      const res = await fetch("/api/me/pfp", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Upload failed");
      setPfpFile(null);
      const res2 = await fetch("/api/me/profile", { cache: "no-store" });
      const j2 = await res2.json().catch(() => null);
      setPfpSignedUrl(j2?.profile?.pfp_url ?? null);
    } catch (e: any) { alert(e?.message ?? "Upload failed"); } finally { setPfpUploading(false); }
  }

  // ── Tab button ───────────────────────────────────────────────────────────────
  function TabButton({ k, label }: { k: TabKey; label: string }) {
    const active = tab === k;
    return (
      <button
        type="button"
        onClick={() => setTab(k)}
        className={[
          "relative rounded-xl px-3 py-2 text-sm transition",
          active ? "bg-white text-black" : "border border-white/10 bg-white/5 text-white hover:bg-white/10"
        ].join(" ")}
      >
        {label}
        {k === "notifications" && unseenCount > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-zinc-950" />
        )}
      </button>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-lg px-6 py-10">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">Account</h1>
            <p className="mt-1 truncate text-sm text-zinc-400">
              {owner ? `Wallet ${shortAddr(owner)}` : "Wallet —"}
            </p>
          </div>
          {tab === "wallet" && loading && <span className="text-xs text-zinc-400">Loading…</span>}
          {tab === "communities" && commLoading && <span className="text-xs text-zinc-400">Loading…</span>}
          {tab === "following" && followLoading && <span className="text-xs text-zinc-400">Loading…</span>}
          {tab === "notifications" && notiLoading && <span className="text-xs text-zinc-400">Loading…</span>}
          {tab === "profile" && profLoading && !isDev && <span className="text-xs text-zinc-400">Loading…</span>}
        </div>

        {/* Tab bar */}
        <div className="mt-5 flex flex-wrap gap-2">
          <TabButton k="wallet" label="Wallet" />
          <TabButton k="communities" label="Communities" />
          <TabButton k="following" label="Following" />
          <TabButton k="notifications" label="Notifications" />
          {!isDev && <TabButton k="profile" label="Profile" />}
        </div>

        {/* ── WALLET TAB ─────────────────────────────────────────────────────── */}
        {!connected && tab === "wallet" && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-zinc-300">Connect a wallet to view your portfolio.</p>
          </div>
        )}

        {tab === "wallet" && connected && (
          <>
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl">
              <p className="text-xs text-zinc-400">Total balance</p>
              <div className="mt-2 flex items-end justify-between gap-3">
                <p className="text-3xl font-semibold tracking-tight">{fmtUsd(data?.totalUsd ?? null)}</p>
                <div className="text-right">
                  <p className="text-xs text-zinc-500">SOL</p>
                  <p className="text-sm text-zinc-300">{data ? fmtAmt(data.sol) : "—"}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-zinc-500">USD is estimated from live prices. Some tokens won't have a price.</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Link href={`/trade?outputMint=${encodeURIComponent(WSOL_MINT)}`} className="rounded-2xl bg-white px-4 py-3 text-center text-sm font-semibold text-black hover:bg-zinc-200">Swap</Link>
                <Link href="/coins" className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-center text-sm hover:bg-white/10">Browse coins</Link>
              </div>
            </div>

            {err && (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-200">{err}</p>
              </div>
            )}

            <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Tokens</h2>
                <span className="text-xs text-zinc-400">{rows.length ? `${rows.length}` : ""}</span>
              </div>
              <div className="mt-4 divide-y divide-white/10">
                {rows.map((r) => (
                  <div key={r.key} className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="mt-1 text-xs text-zinc-400">{fmtAmt(r.amount)} {r.usdPrice ? `• $${r.usdPrice.toFixed(6)}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm">{fmtUsd(r.usdValue ?? null)}</p>
                      {r.mint !== WSOL_MINT && (
                        <div className="mt-2 flex justify-end gap-2">
                          <Link href={`/trade?outputMint=${encodeURIComponent(r.mint)}`} className="rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-zinc-200">Buy</Link>
                          <Link href={`/trade?inputMint=${encodeURIComponent(r.mint)}&outputMint=${encodeURIComponent(WSOL_MINT)}`} className="rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs hover:bg-white/10">Sell</Link>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {!loading && connected && rows.length === 0 && (
                  <p className="py-6 text-sm text-zinc-300">No tokens found.</p>
                )}
              </div>
              <p className="mt-4 text-xs text-zinc-500">Tip: If a token shows no USD value, it may not have a reliable live price yet.</p>
            </div>
          </>
        )}

        {/* ── COMMUNITIES TAB ────────────────────────────────────────────────── */}
        {tab === "communities" && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {commTab === "mine" ? "My Communities" : "Communities"}
              </h2>
              <span className="text-xs text-zinc-400">{commLoading ? "Loading…" : ""}</span>
            </div>

            {/* Sub-tabs — only shown to devs */}
            {isDev && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setCommTab("all")}
                  className={[
                    "rounded-xl px-3 py-1.5 text-xs font-semibold border transition",
                    commTab === "all"
                      ? "bg-white text-black border-white"
                      : "bg-white/5 text-white border-white/10 hover:bg-white/10"
                  ].join(" ")}
                >
                  Communities
                </button>
                <button
                  onClick={() => setCommTab("mine")}
                  className={[
                    "rounded-xl px-3 py-1.5 text-xs font-semibold border transition",
                    commTab === "mine"
                      ? "bg-white text-black border-white"
                      : "bg-white/5 text-white border-white/10 hover:bg-white/10"
                  ].join(" ")}
                >
                  My Communities
                </button>
              </div>
            )}

            {commErr && (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-200">{commErr}</p>
              </div>
            )}

            {(() => {
              const displayed = commTab === "mine"
                ? communities.filter((c) => c.viewerRole === "dev")
                : communities;

              return (
                <div className="mt-4 space-y-2">
                  {displayed.length === 0 && !commLoading ? (
                    <div className="text-sm text-zinc-500">
                      {commTab === "mine"
                        ? "You haven't launched any communities yet. Create one from your dev profile."
                        : "You haven't joined any communities yet. Join one from a coin page."}
                    </div>
                  ) : (
                    displayed.map((c) => (
                      <Link key={c.id} href={`/community/${encodeURIComponent(c.id)}`} className="block rounded-2xl border border-white/10 bg-black/30 p-4 hover:bg-black/40 transition">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate text-sm font-semibold">{c.title || "Coin community"}</div>
                              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">{c.viewerRole === "dev" ? "Owner" : "Member"}</span>
                            </div>
                            <div className="mt-1 text-xs text-zinc-500">Coin: <span className="font-mono text-zinc-400">{shortAddr(c.coin_id)}</span></div>
                          </div>
                          <span className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">Open →</span>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              );
            })()}

            <p className="mt-4 text-xs text-zinc-500">
              {commTab === "mine"
                ? "These are the communities attached to coins you've posted."
                : "Communities are private — you can only view messages after joining."}
            </p>
          </div>
        )}

        {/* ── FOLLOWING TAB ──────────────────────────────────────────────────── */}
        {tab === "following" && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Following</h2>
              <span className="text-xs text-zinc-400">{followLoading ? "Loading…" : ""}</span>
            </div>
            {followErr && (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-200">{followErr}</p>
              </div>
            )}
            <div className="mt-4 space-y-2">
              {following.length === 0 && !followLoading ? (
                <div className="text-sm text-zinc-500">You aren't following any devs yet. Browse devs on the Dashboard and hit Follow.</div>
              ) : (
                following.map((w) => {
                  const meta = followMetaByWallet[w];
                  const name = meta?.name?.trim() || shortAddr(w);
                  const pfpUrl = meta?.pfpUrl ?? null;
                  return (
                    <Link key={w} href={`/dev/${encodeURIComponent(w)}`} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 p-4 hover:bg-black/40 transition" title={w}>
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {pfpUrl ? <img src={pfpUrl} alt="" className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-zinc-200">{name}</div>
                          <div className="mt-1 font-mono text-[11px] text-zinc-500">{w}</div>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">View →</span>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ── NOTIFICATIONS TAB ──────────────────────────────────────────────── */}
        {tab === "notifications" && (
          <div className="mt-6">

            {/* Header row */}
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-lg font-semibold">Notifications</h2>
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  disabled={clearingAll}
                  className="text-xs text-zinc-400 transition hover:text-white disabled:opacity-50"
                >
                  {clearingAll ? "Clearing…" : "Clear all"}
                </button>
              )}
            </div>

            {notiErr && (
              <div className="mb-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-200">{notiErr}</p>
              </div>
            )}

            {/* Empty state */}
            {!notiLoading && notifications.length === 0 && (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-10 text-center">
                <p className="text-3xl">🔔</p>
                <p className="mt-3 text-sm font-medium text-zinc-300">No notifications yet</p>
                <p className="mt-1 text-xs text-zinc-500">When devs you follow post updates or list new coins, they'll appear here.</p>
              </div>
            )}

            {/* iPhone lock-screen style notification cards */}
            <div className="space-y-2">
              {notifications.map((n) => {
                const isNew = !n.seen;
                const isPost = n.type === "new_post";

                return (
                  <div
                    key={n.id}
                    className={[
                      "group relative overflow-hidden rounded-2xl border transition-all",
                      isNew
                        ? "border-white/20 bg-white/10 shadow-lg shadow-black/30"
                        : "border-white/[0.08] bg-white/5"
                    ].join(" ")}
                  >
                    {/* Unread left-edge indicator bar */}
                    {isNew && (
                      <span className="absolute inset-y-0 left-0 w-[3px] rounded-l-2xl bg-white/60" />
                    )}

                    {/* Clickable body — navigates to linked page */}
                    <button
                      onClick={() => router.push(n.link)}
                      className="w-full px-4 pb-3 pt-3 text-left"
                    >
                      <div className="flex items-start gap-3">
                        {/* iOS-style app icon */}
                        <div className={[
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base",
                          isPost ? "bg-blue-500/20 text-blue-400" : "bg-amber-500/20 text-amber-400"
                        ].join(" ")}>
                          {isPost ? "📝" : "🪙"}
                        </div>

                        <div className="min-w-0 flex-1">
                          {/* App name + timestamp row */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                              {isPost ? "New Post" : "New Coin"}
                            </span>
                            <span className="shrink-0 text-[11px] text-zinc-500">
                              {timeAgo(n.created_at)}
                            </span>
                          </div>

                          {/* Title line */}
                          <p className={[
                            "mt-0.5 text-sm leading-snug",
                            isNew ? "font-semibold text-white" : "font-medium text-zinc-200"
                          ].join(" ")}>
                            {shortAddr(n.actor_wallet)} {n.title}
                          </p>

                          {/* Body preview */}
                          {n.body && (
                            <p className="mt-1 line-clamp-2 text-xs text-zinc-400">
                              {n.body}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Clear button at the bottom — like swiping away on iOS */}
                    <div className="flex justify-end border-t border-white/[0.06] px-4 py-1.5">
                      <button
                        onClick={() => clearOne(n.id)}
                        disabled={clearingId === n.id}
                        className="text-[11px] text-zinc-500 transition hover:text-red-400 disabled:opacity-40"
                      >
                        {clearingId === n.id ? "Removing…" : "Clear"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {notifications.length > 0 && (
              <p className="mt-4 text-center text-xs text-zinc-600">
                {notifications.length} notification{notifications.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        )}

        {/* ── PROFILE TAB ────────────────────────────────────────────────────── */}
        {tab === "profile" && !isDev && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Profile</h2>
              <span className="text-xs text-zinc-400">{profLoading ? "Loading…" : ""}</span>
            </div>
            {profErr && (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-200">{profErr}</p>
              </div>
            )}
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
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0] || null; setPfpFile(f); }} />
                    </label>
                    <button onClick={uploadPfp} disabled={!pfpFile || pfpUploading} className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-60">
                      {pfpUploading ? "Uploading…" : "Upload"}
                    </button>
                    {pfpFile && (
                      <button onClick={() => setPfpFile(null)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10">Cancel</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              <input className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm" placeholder="Display name (optional)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
            </div>
            <button onClick={saveProfile} disabled={profSaving} className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60">
              {profSaving ? "Saving…" : "Save profile"}
            </button>
            <p className="mt-3 text-xs text-zinc-500">This profile is not a public page — it's just used to show your name + avatar on comments, reviews and community posts.</p>
          </div>
        )}
      </div>
    </main>
  );
}
