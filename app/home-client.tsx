"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import GetStartedModal from "@/components/GetStartedModal";
import Footer from "@/components/Footer";
import InviteCodeModal from "@/components/InviteCodeModal";
import BecomeDevModal from "@/components/BecomeDevModal";

export default function HomeClient() {
  const searchParams = useSearchParams();

  const [openGetStarted, setOpenGetStarted] = useState(false);
  const [openInvite, setOpenInvite] = useState(false);
  const [openBecomeDev, setOpenBecomeDev] = useState(false);

  // What triggered the modal — used to show the right messaging
  const [modalIntent, setModalIntent] = useState<"subscribe" | "trial" | "upgrade" | null>(null);

  useEffect(() => {
    const subscribe     = searchParams.get("subscribe")     === "1";
    const getstarted    = searchParams.get("getstarted")    === "1";
    const trialUpgrade  = searchParams.get("trial_upgrade") === "1";

    if (trialUpgrade) {
      setModalIntent("upgrade");
      setOpenGetStarted(true);
    } else if (subscribe || getstarted) {
      setModalIntent("subscribe");
      setOpenGetStarted(true);
    }
  }, [searchParams]);

  const isTrialUpgrade = modalIntent === "upgrade";

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

        {/* ── CTAs ──────────────────────────────────────────────────────────── */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* Primary — subscribe / trial (opens modal showing both options) */}
          <button
            onClick={() => { setModalIntent("subscribe"); setOpenGetStarted(true); }}
            className="rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-zinc-200 transition"
          >
            Get started — Subscribe or free trial
          </button>

          {/* Secondary — sign in for returning users */}
          <button
            onClick={() => { setModalIntent("subscribe"); setOpenGetStarted(true); }}
            className="rounded-2xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10 transition"
          >
            Sign in
          </button>
        </div>

        {/* Disclaimer */}
        <p className="mt-3 text-xs text-zinc-500">
          Already have a subscription or free trial? Click Sign in above.
        </p>

        {/* ── Feature cards ──────────────────────────────────────────────────── */}
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            { title: "Verified dev profiles", body: "Follow devs, see posted coins, and watch upcoming projects." },
            { title: "Coins directory + filters", body: "Browse every posted token address and details in one place." },
            { title: "Swap inside Authswap", body: "Trade via Jupiter UI — fast, familiar, trusted." }
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl">
              <h3 className="text-base font-semibold">{c.title}</h3>
              <p className="mt-2 text-sm text-zinc-300">{c.body}</p>
            </div>
          ))}
        </div>

        {/* ── What's included comparison ─────────────────────────────────────── */}
        <div className="mt-12 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold mb-4">What's included</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { label: "Browse coins & dev profiles",  trial: true,  paid: true  },
              { label: "Live price charts & trades",   trial: true,  paid: true  },
              { label: "Dashboard & following feed",   trial: false, paid: true  },
              { label: "Join & post in communities",   trial: false, paid: true  },
              { label: "Comment & upvote coins",       trial: false, paid: true  },
              { label: "Leave dev reviews",            trial: false, paid: true  },
              { label: "Follow devs",                  trial: false, paid: true  },
              { label: "Jupiter swap inside Authswap", trial: false, paid: true  },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                <span className="text-sm text-zinc-300">{row.label}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-zinc-500 w-10 text-center">
                    {row.trial ? <span className="text-emerald-400">✓</span> : <span className="text-zinc-600">—</span>}
                  </span>
                  <span className="text-xs text-zinc-500 w-10 text-center">
                    {row.paid ? <span className="text-emerald-400">✓</span> : <span className="text-zinc-600">—</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-3 text-xs text-zinc-500">
            <span className="w-10 text-center">Trial</span>
            <span className="w-10 text-center">Paid</span>
          </div>
        </div>

        <GetStartedModal
          open={openGetStarted}
          onClose={() => { setOpenGetStarted(false); setModalIntent(null); }}
          intent={modalIntent}
        />
        <InviteCodeModal open={openInvite} onClose={() => setOpenInvite(false)} />
        <BecomeDevModal open={openBecomeDev} onClose={() => setOpenBecomeDev(false)} />

        <Footer
          onInviteCode={() => setOpenInvite(true)}
          onBecomeDev={() => setOpenBecomeDev(true)}
        />
      </div>
    </main>
  );
}
