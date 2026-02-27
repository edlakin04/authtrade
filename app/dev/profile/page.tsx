"use client";

import React, { useEffect, useState } from "react";
import TopNav from "@/components/TopNav";

type Profile = {
  wallet: string;
  display_name: string;
  bio: string | null;
  pfp_url: string | null;
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

export default function DevProfilePage() {
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [pfpUrl, setPfpUrl] = useState("");
  const [xUrl, setXUrl] = useState("");

  const [postContent, setPostContent] = useState("");

  const [coinAddr, setCoinAddr] = useState("");
  const [coinTitle, setCoinTitle] = useState("");
  const [coinDesc, setCoinDesc] = useState("");

  async function refresh() {
    setLoading(true);
    const res = await fetch("/api/dev/profile");
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
      setPfpUrl(data.profile.pfp_url ?? "");
      setXUrl(data.profile.x_url ?? "");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function saveProfile() {
    const res = await fetch("/api/dev/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: displayName,
        bio,
        pfp_url: pfpUrl || null,
        x_url: xUrl || null
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data?.error ?? "Save failed");

    await refresh();
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

              <div className="mt-4 grid gap-3">
                <input
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <input
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                  placeholder="Profile image URL (optional)"
                  value={pfpUrl}
                  onChange={(e) => setPfpUrl(e.target.value)}
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
                  coins.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-zinc-200">{c.title ?? "Untitled coin"}</div>
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

                      {/* No remove button on purpose */}
                      <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
                        Permanent
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
