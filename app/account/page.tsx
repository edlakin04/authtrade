"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import TopNav from "@/components/TopNav";

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

type TabKey = "wallet" | "communities" | "following" | "profile";

export default function AccountPage() {
  const { publicKey, connected } = useWallet();

  const [tab, setTab] = useState<TabKey>("wallet");

  // ✅ NEW: detect dev role so we can hide Profile tab for devs
  // null = unknown/loading, false = not dev, true = dev
  const [isDev, setIsDev] = useState<boolean | null>(null);

  // Wallet/portfolio state
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Portfolio | null>(null);

  // Communities state
  const [commLoading, setCommLoading] = useState(false);
  const [commErr, setCommErr] = useState<string | null>(null);
  const [communities, setCommunities] = useState<MyCommunitiesPayload["communities"]>([]);

  // Following state
  const [followLoading, setFollowLoading] = useState(false);
  const [followErr, setFollowErr] = useState<string | null>(null);
  const [following, setFollowing] = useState<string[]>([]);
  const [followMetaByWallet, setFollowMetaByWallet] = useState<
    Record<string, { name: string | null; pfpUrl: string | null }>
  >({});

  // Profile state
  const [profLoading, setProfLoading] = useState(false);
  const [profErr, setProfErr] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [pfpSignedUrl, setPfpSignedUrl] = useState<string | null>(null);

  const [pfpFile, setPfpFile] = useState<File | null>(null);
  const [pfpUploading, setPfpUploading] = useState(false);
  const [profSaving, setProfSaving] = useState(false);

  const owner = useMemo(() => publicKey?.toBase58() ?? "", [publicKey]);

  // ✅ NEW: detect dev by calling /api/dev/profile
  // - if 200 => dev (or admin)
  // - if 401/403/404 => not dev (for this purpose)
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

    return () => {
      cancelled = true;
    };
  }, []);

  // ✅ NEW: if they are a dev and somehow on Profile tab, bounce them off it
  useEffect(() => {
    if (isDev && tab === "profile") {
      setTab("wallet");
    }
  }, [isDev, tab]);

  // --- Portfolio load (Wallet tab)
  useEffect(() => {
    if (!connected || !owner) {
      setData(null);
      setErr(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/portfolio?owner=${encodeURIComponent(owner)}`, {
          cache: "no-store"
        });

        const text = await res.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
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

    return () => {
      cancelled = true;
    };
  }, [connected, owner]);

  // --- Communities load (Communities tab)
  useEffect(() => {
    if (tab !== "communities") return;

    let cancelled = false;

    (async () => {
      setCommLoading(true);
      setCommErr(null);
      try {
        const res = await fetch("/api/communities/me", { cache: "no-store" });
        const json = await res.json().catch(() => null);

        if (!res.ok) throw new Error(json?.error || "Failed to load communities");
        if (!cancelled) setCommunities((json?.communities ?? []) as MyCommunitiesPayload["communities"]);
      } catch (e: any) {
        if (!cancelled) {
          setCommErr(e?.message ?? "Failed to load communities");
          setCommunities([]);
        }
      } finally {
        if (!cancelled) setCommLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab]);

  // --- Following load (Following tab) + fetch dev names/pfps in ONE call
  useEffect(() => {
    if (tab !== "following") return;

    let cancelled = false;

    (async () => {
      setFollowLoading(true);
      setFollowErr(null);
      try {
        const res = await fetch("/api/following/feed", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as FollowingFeedPayload | null;

        if (!res.ok) throw new Error((json as any)?.error || "Failed to load following");

        const wallets = (json?.devWallets ?? []) as string[];
        if (!cancelled) setFollowing(wallets);

        // ✅ Batch-load dev profile meta (name + signed pfp)
        const res2 = await fetch("/api/public/dev/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallets })
        });

        const json2 = (await res2.json().catch(() => null)) as DevBatchPayload | any;
        if (!res2.ok) {
          // Don’t hard-fail the whole tab; just fall back to wallets
          if (!cancelled) setFollowMetaByWallet({});
        } else {
          const map: Record<string, { name: string | null; pfpUrl: string | null }> = {};
          for (const p of (json2?.profiles ?? []) as DevBatchPayload["profiles"]) {
            map[p.wallet] = { name: p.display_name ?? null, pfpUrl: p.pfp_url ?? null };
          }
          if (!cancelled) setFollowMetaByWallet(map);
        }
      } catch (e: any) {
        if (!cancelled) {
          setFollowErr(e?.message ?? "Failed to load following");
          setFollowing([]);
          setFollowMetaByWallet({});
        }
      } finally {
        if (!cancelled) setFollowLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab]);

  // --- Profile load (Profile tab)
  useEffect(() => {
    if (tab !== "profile") return;

    // ✅ NEW: devs should never load the normal profile tab
    if (isDev) return;

    let cancelled = false;

    (async () => {
      setProfLoading(true);
      setProfErr(null);
      try {
        const res = await fetch("/api/me/profile", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as MyProfilePayload | any;

        if (!res.ok) throw new Error(json?.error || "Failed to load profile");

        if (!cancelled) {
          setDisplayName(json?.profile?.display_name ?? "");
          setPfpSignedUrl(json?.profile?.pfp_url ?? null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setProfErr(e?.message ?? "Failed to load profile");
          setDisplayName("");
          setPfpSignedUrl(null);
        }
      } finally {
        if (!cancelled) setProfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab, isDev]);

  const rows = useMemo(() => {
    if (!data) return [];

    const solRow = {
      key: "SOL",
      name: "SOL",
      mint: WSOL_MINT,
      amount: data.sol,
      usdValue: data.solUsdValue,
      usdPrice: data.solUsd
    };

    const tokenRows = (data.tokens || []).map((t) => ({
      key: t.mint,
      name: shortAddr(t.mint),
      mint: t.mint,
      amount: t.uiAmount,
      usdValue: t.usdValue,
      usdPrice: t.usdPrice
    }));

    return [solRow, ...tokenRows];
  }, [data]);

  function TabButton({ k, label }: { k: TabKey; label: string }) {
    const active = tab === k;
    return (
      <button
        type="button"
        onClick={() => setTab(k)}
        className={[
          "rounded-xl px-3 py-2 text-sm transition",
          active ? "bg-white text-black" : "border border-white/10 bg-white/5 text-white hover:bg-white/10"
        ].join(" ")}
      >
        {label}
      </button>
    );
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

  async function saveProfile() {
    setProfSaving(true);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      alert("Saved.");
    } catch (e: any) {
      alert(e?.message ?? "Save failed");
    } finally {
      setProfSaving(false);
    }
  }

  async function uploadPfp() {
    if (!pfpFile) return;
    setPfpUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", pfpFile);

      const res = await fetch("/api/me/pfp", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Upload failed");

      setPfpFile(null);

      // refresh signed url
      const res2 = await fetch("/api/me/profile", { cache: "no-store" });
      const j2 = await res2.json().catch(() => null);
      setPfpSignedUrl(j2?.profile?.pfp_url ?? null);
    } catch (e: any) {
      alert(e?.message ?? "Upload failed");
    } finally {
      setPfpUploading(false);
    }
  }

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
          {tab === "profile" && profLoading && !isDev && <span className="text-xs text-zinc-400">Loading…</span>}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <TabButton k="wallet" label="Wallet" />
          <TabButton k="communities" label="Communities" />
          <TabButton k="following" label="Following" />
          {/* ✅ hide for devs */}
          {!isDev && <TabButton k="profile" label="Profile" />}
        </div>

        {!connected && tab === "wallet" && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-zinc-300">Connect a wallet to view your portfolio.</p>
          </div>
        )}

        {/* WALLET TAB */}
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

              <p className="mt-2 text-xs text-zinc-500">
                USD is estimated from live prices. Some tokens won’t have a price.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-2">
                <Link
                  href={`/trade?outputMint=${encodeURIComponent(WSOL_MINT)}`}
                  className="rounded-2xl bg-white px-4 py-3 text-center text-sm font-semibold text-black hover:bg-zinc-200"
                >
                  Swap
                </Link>
                <Link
                  href="/coins"
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-center text-sm hover:bg-white/10"
                >
                  Browse coins
                </Link>
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
                      <p className="mt-1 text-xs text-zinc-400">
                        {fmtAmt(r.amount)} {r.usdPrice ? `• $${r.usdPrice.toFixed(6)}` : ""}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm">{fmtUsd(r.usdValue ?? null)}</p>

                      {r.mint !== WSOL_MINT && (
                        <div className="mt-2 flex justify-end gap-2">
                          <Link
                            href={`/trade?outputMint=${encodeURIComponent(r.mint)}`}
                            className="rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-zinc-200"
                          >
                            Buy
                          </Link>
                          <Link
                            href={`/trade?inputMint=${encodeURIComponent(r.mint)}&outputMint=${encodeURIComponent(
                              WSOL_MINT
                            )}`}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs hover:bg-white/10"
                          >
                            Sell
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {!loading && connected && rows.length === 0 && (
                  <p className="py-6 text-sm text-zinc-300">No tokens found.</p>
                )}
              </div>

              <p className="mt-4 text-xs text-zinc-500">
                Tip: If a token shows no USD value, it may not have a reliable live price yet.
              </p>
            </div>
          </>
        )}

        {/* COMMUNITIES TAB */}
        {tab === "communities" && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Communities</h2>
              <span className="text-xs text-zinc-400">{commLoading ? "Loading…" : ""}</span>
            </div>

            {commErr ? (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-200">{commErr}</p>
              </div>
            ) : null}

            <div className="mt-4 space-y-2">
              {communities.length === 0 && !commLoading ? (
                <div className="text-sm text-zinc-500">
                  You haven’t joined any communities yet. Join one from a coin page.
                </div>
              ) : (
                communities.map((c) => (
                  <Link
                    key={c.id}
                    href={`/community/${encodeURIComponent(c.id)}`}
                    className="block rounded-2xl border border-white/10 bg-black/30 p-4 hover:bg-black/40 transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-semibold">{c.title || "Coin community"}</div>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">
                            {c.viewerRole === "dev" ? "Owner" : "Member"}
                          </span>
                        </div>

                        <div className="mt-1 text-xs text-zinc-500">
                          Coin: <span className="font-mono text-zinc-400">{shortAddr(c.coin_id)}</span>
                        </div>
                      </div>

                      <span className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">
                        Open →
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>

            <p className="mt-4 text-xs text-zinc-500">
              Communities are private — you can only view messages after joining.
            </p>
          </div>
        )}

        {/* FOLLOWING TAB */}
        {tab === "following" && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Following</h2>
              <span className="text-xs text-zinc-400">{followLoading ? "Loading…" : ""}</span>
            </div>

            {followErr ? (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-200">{followErr}</p>
              </div>
            ) : null}

            <div className="mt-4 space-y-2">
              {following.length === 0 && !followLoading ? (
                <div className="text-sm text-zinc-500">
                  You aren’t following any devs yet. Browse devs on the Dashboard and hit Follow.
                </div>
              ) : (
                following.map((w) => {
                  const meta = followMetaByWallet[w];
                  const name = meta?.name?.trim() || shortAddr(w);
                  const pfpUrl = meta?.pfpUrl ?? null;

                  return (
                    <Link
                      key={w}
                      href={`/dev/${encodeURIComponent(w)}`}
                      className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 p-4 hover:bg-black/40 transition"
                      title={w}
                    >
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

                      <span className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">
                        View →
                      </span>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* PROFILE TAB */}
        {tab === "profile" && !isDev && (
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Profile</h2>
              <span className="text-xs text-zinc-400">{profLoading ? "Loading…" : ""}</span>
            </div>

            {profErr ? (
              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-200">{profErr}</p>
              </div>
            ) : null}

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
                placeholder="Display name (optional)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={40}
              />
            </div>

            <button
              onClick={saveProfile}
              disabled={profSaving}
              className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
            >
              {profSaving ? "Saving…" : "Save profile"}
            </button>

            <p className="mt-3 text-xs text-zinc-500">
              This profile is not a public page — it’s just used to show your name + avatar on comments, reviews and
              community posts.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
