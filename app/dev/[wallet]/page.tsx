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

export default function DevPublicPage({
  params
}: {
  params: Promise<{ wallet: string }>;
}) {
  const [devWallet, setDevWallet] = useState<string>("");

  const [data, setData] = useState<DevPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await params;
      setDevWallet(p.wallet);
    })();
  }, [params]);

  const shortWallet = useMemo(() => {
    if (!devWallet) return "";
    return devWallet.slice(0, 4) + "…" + devWallet.slice(-4);
  }, [devWallet]);

  async function load(wallet: string) {
    setErr(null);
    const res = await fetch(`/api/public/dev/${encodeURIComponent(wallet)}`);
    const json = await res.json().catch(() => null);

    if (!res.ok) {
      setErr(json?.error ?? "Failed to load dev");
      setData(null);
      return;
    }

    setData(json);
  }

  useEffect(() => {
    if (devWallet) load(devWallet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devWallet]);

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

      await load(devWallet);
    } finally {
      setBusy(false);
    }
  }

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
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 overflow-hidden rounded-full border border-white/10 bg-white/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {data.profile.pfp_url ? (
                    <img src={data.profile.pfp_url} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>

                <div className="min-w-0">
                  <div className="text-lg font-semibold">{data.profile.display_name}</div>
                  <div className="mt-1 text-xs text-zinc-400">Wallet: {shortWallet}</div>
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

              {data.profile.bio ? (
                <p className="mt-4 text-sm text-zinc-300">{data.profile.bio}</p>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">No bio yet.</p>
              )}
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
                    data.coins.slice(0, 30).map((c) => (
                      <div key={c.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <div className="text-sm font-semibold">{c.title ?? "Untitled coin"}</div>
                        <div className="mt-1 break-all font-mono text-xs text-zinc-400">{c.token_address}</div>
                        {c.description ? <div className="mt-2 text-xs text-zinc-300">{c.description}</div> : null}

                        <Link
                          href={`/trade?outputMint=${encodeURIComponent(c.token_address)}`}
                          className="mt-3 inline-block rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-zinc-200"
                          title="Open Jupiter swap"
                        >
                          Trade
                        </Link>
                      </div>
                    ))
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
