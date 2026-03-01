"use client";

import React, { useEffect, useMemo, useState } from "react";
import TopNav from "@/components/TopNav";
import Link from "next/link";

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

export default function DevProfilePage() {
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [xUrl, setXUrl] = useState("");

  const [postContent, setPostContent] = useState("");

  const [coinAddr, setCoinAddr] = useState("");
  const [coinTitle, setCoinTitle] = useState("");
  const [coinDesc, setCoinDesc] = useState("");

  // Signed PFP url for previewing current avatar
  const [pfpSignedUrl, setPfpSignedUrl] = useState<string | null>(null);

  // Upload state
  const [pfpFile, setPfpFile] = useState<File | null>(null);
  const [pfpUploading, setPfpUploading] = useState(false);

  // Coin metadata (name/symbol/logo) keyed by mint
  const [metaByMint, setMetaByMint] = useState<Record<string, LiveMeta | null>>({});
  const [metaLoadingMints, setMetaLoadingMints] = useState<Record<string, boolean>>({});

  // Community status keyed by coin id
  const [communityByCoinId, setCommunityByCoinId] = useState<Record<string, Community | null>>({});
  const [communityLoadingByCoinId, setCommunityLoadingByCoinId] = useState<Record<string, boolean>>({});
  const [communityCreatingByCoinId, setCommunityCreatingByCoinId] = useState<Record<string, boolean>>({});

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
    setPosts(data.posts ?? []);

    if (data.profile) {
      setDisplayName(data.profile.display_name ?? "");
      setBio(data.profile.bio ?? "");
      setXUrl(data.profile.x_url ?? "");
    }

    // Fetch signed url for current wallet’s pfp
    const w = data?.profile?.wallet;
    if (w) {
      const p = await fetch(`/api/public/pfp?wallet=${encodeURIComponent(w)}`, { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null);
      setPfpSignedUrl(p?.url ?? null);
    } else {
      setPfpSignedUrl(null);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // ---- Coin meta fetching (same source as coin page: /api/coin-live) ----
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

  // ---- Community status fetching (per coin) ----
  async function fetchCommunityForCoin(coinId: string) {
    const id = (coinId || "").trim();
    if (!id) return;

    if (Object.prototype.hasOwnProperty.call(communityByCoinId, id)) return;

    setCommunityLoadingByCoinId((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/coin/${encodeURIComponent(id)}/community`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as CommunityGet | null;

      if (!res.ok) {
        // treat as none, but don’t break UI
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
        // NOTE: no pfp_url here anymore (private storage + signed urls)
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

  async function createPost() {
    const res = await fetch("/api/dev/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: postContent })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data?.error ?? "Post failed");

    setPostContent("");
    await refresh();
  }

  async function addCoin() {
    const res = await fetch("/api/dev/coins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token_address: coinAddr,
        title: coinTitle || null,
        description: coinDesc || null
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data?.error ?? "Add coin failed");

    setCoinAddr("");
    setCoinTitle("");
    setCoinDesc("");
    await refresh();
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

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Dev Profile</h1>
        <p className="mt-1 text-sm text-zinc-400">Edit your public profile, post updates, and list coins.</p>

        {loading ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Profile</h2>

              {/* Avatar upload */}
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 overflow-hidden rounded-full border border-white/10 bg-white/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {localPreview || pfpSignedUrl ? (
                      <img
                        src={localPreview || pfpSignedUrl || ""}
                        alt=""
                        className="h-full w-full object-cover"
                      />
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
              />
              <button
                onClick={createPost}
                className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
              >
                Post update
              </button>

              <div className="mt-6">
                <h3 className="text-sm font-semibold text-zinc-200">Recent updates</h3>
                <div className="mt-3 space-y-2">
                  {posts.length === 0 ? (
                    <div className="text-sm text-zinc-500">No posts yet.</div>
                  ) : (
                    posts.slice(0, 5).map((p) => (
                      <div key={p.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <div className="text-xs text-zinc-500">{new Date(p.created_at).toLocaleString()}</div>
                        <div className="mt-1 text-sm text-zinc-200">{p.content}</div>
                      </div>
                    ))
                  )}
                </div>
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

                        {/* Right side actions (community) */}
                        <div className="shrink-0 flex flex-col items-end gap-2">
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
