"use client";

import React, { useEffect, useState } from "react";
import TopNav from "@/components/TopNav";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/public/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ error: "Failed to load" }));
  }, []);

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">Trending devs, updates, and newly posted coins.</p>

        {!data ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : data.error ? (
          <div className="mt-6 text-red-300">{data.error}</div>
        ) : (
          <div className="mt-6 grid gap-6">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Trending devs</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {(data.profiles ?? []).length === 0 ? (
                  <div className="text-sm text-zinc-500">No dev profiles yet.</div>
                ) : (
                  (data.profiles ?? []).map((p: any) => (
                    <div key={p.wallet} className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 overflow-hidden rounded-full border border-white/10 bg-white/5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {p.pfp_url ? <img src={p.pfp_url} alt="" className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{p.display_name}</div>
                          <div className="truncate font-mono text-[11px] text-zinc-500">{p.wallet}</div>
                        </div>
                      </div>
                      {p.bio ? <div className="mt-3 text-xs text-zinc-300">{p.bio}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Latest updates</h2>
              <div className="mt-4 space-y-2">
                {(data.posts ?? []).length === 0 ? (
                  <div className="text-sm text-zinc-500">No updates yet.</div>
                ) : (
                  (data.posts ?? []).slice(0, 10).map((x: any) => (
                    <div key={x.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <div className="font-mono text-[11px] text-zinc-500">{x.wallet}</div>
                      <div className="mt-1 text-sm text-zinc-200">{x.content}</div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">New coins</h2>
              <div className="mt-4 grid gap-2">
                {(data.coins ?? []).length === 0 ? (
                  <div className="text-sm text-zinc-500">No coins posted yet.</div>
                ) : (
                  (data.coins ?? []).slice(0, 12).map((c: any) => (
                    <div key={c.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <div className="text-sm font-semibold">{c.title ?? "Untitled coin"}</div>
                      <div className="mt-1 break-all font-mono text-xs text-zinc-400">{c.token_address}</div>
                      <div className="mt-1 text-xs text-zinc-500">Posted by {c.wallet}</div>
                      {c.description ? <div className="mt-2 text-xs text-zinc-300">{c.description}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
