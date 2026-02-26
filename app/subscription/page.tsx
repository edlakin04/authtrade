"use client";

import React, { useEffect, useState } from "react";
import TopNav from "@/components/TopNav";

export default function SubscriptionPage() {
  const [ctx, setCtx] = useState<any>(null);

  useEffect(() => {
    fetch("/api/context/refresh", { method: "POST" })
      .then((r) => r.json())
      .then(setCtx)
      .catch(() => setCtx({ error: "Failed to load" }));
  }, []);

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Subscription</h1>
        <p className="mt-2 text-sm text-zinc-400">View your current status. Cancel flow comes later.</p>

        {!ctx ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : ctx.error ? (
          <div className="mt-6 text-red-300">{ctx.error}</div>
        ) : (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm text-zinc-300">Role: <span className="font-semibold text-white">{ctx.role}</span></div>
            <div className="mt-2 text-sm text-zinc-300">
              Subscription:{" "}
              <span className="font-semibold text-white">
                {ctx.subscribedActive ? "Active" : "Inactive"}
              </span>
            </div>
            {ctx.paidUntilMs ? (
              <div className="mt-2 text-sm text-zinc-400">
                Paid until: {new Date(ctx.paidUntilMs).toLocaleString()}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
