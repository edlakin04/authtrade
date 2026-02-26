"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import GetStartedModal from "@/components/GetStartedModal";
import Footer from "@/components/Footer";

export default function HomePage() {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  // Auto-open if redirected from protected pages
  useEffect(() => {
    const subscribe = searchParams.get("subscribe") === "1";
    const getstarted = searchParams.get("getstarted") === "1";
    if (subscribe || getstarted) setOpen(true);
  }, [searchParams]);

  return (
    <main className="bg-authswap min-h-screen text-white">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-200">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Solana-only • Verified dev directory • Jupiter swaps
        </div>

        <h1 className="mt-6 text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">
          Auth<span className="text-gradient">swap</span>
        </h1>

        <p className="mt-5 max-w-2xl text-zinc-300">
          A paywalled hub for <span className="text-gradient font-semibold">verified devs</span>,{" "}
          <span className="text-gradient font-semibold">upcoming launches</span>, and{" "}
          <span className="text-gradient font-semibold">trending coins</span> — with swaps powered by Jupiter.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            onClick={() => setOpen(true)}
            className="rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-zinc-200"
          >
            Get started
          </button>

          <div className="text-sm text-zinc-400">
            Connect wallet → sign in → subscribe → dashboard
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            { title: "Verified dev profiles", body: "Follow devs, see posted coins, and watch upcoming projects." },
            { title: "Coins directory + filters", body: "Browse every posted token address and details in one place." },
            { title: "Swap inside Authswap", body: "Trade via Jupiter UI — fast, familiar, trusted." }
          ].map((c) => (
            <div
              key={c.title}
              className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl"
            >
              <h3 className="text-base font-semibold">{c.title}</h3>
              <p className="mt-2 text-sm text-zinc-300">{c.body}</p>
            </div>
          ))}
        </div>

        <GetStartedModal open={open} onClose={() => setOpen(false)} />

        <Footer
          onInviteCode={() => alert("Invite code flow comes later (dev onboarding chunk).")}
          onBecomeDev={() => alert("Become a dev flow comes later (dev onboarding chunk).")}
        />
      </div>
    </main>
  );
}
