"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

type TrialCtx = {
  isTrial: boolean;
  trialActive: boolean;
  daysRemaining: number;
  trialExpiresAtMs: number | null;
};

// ─── TrialBanner ──────────────────────────────────────────────────────────────
// Shown at the top of pages trial users can access (/coins, /dev/*).
// Reads trial status from /api/context/refresh (already called on page load).
// Pass isTrial={true} directly if you already have it from context.

type Props = {
  isTrial?: boolean;
  daysRemaining?: number;
};

export default function TrialBanner({ isTrial, daysRemaining }: Props) {
  const [ctx, setCtx] = useState<TrialCtx | null>(null);

  useEffect(() => {
    // If props are passed directly, use them
    if (isTrial !== undefined) {
      setCtx({
        isTrial: !!isTrial,
        trialActive: !!isTrial,
        daysRemaining: daysRemaining ?? 0,
        trialExpiresAtMs: null,
      });
      return;
    }

    // Otherwise fetch from context refresh
    fetch("/api/context/refresh", { method: "POST" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.ok && d?.isTrial) {
          setCtx({
            isTrial: true,
            trialActive: true,
            daysRemaining: d.daysRemaining ?? 0,
            trialExpiresAtMs: d.trialExpiresAtMs ?? null,
          });
        }
      })
      .catch(() => null);
  }, [isTrial, daysRemaining]);

  if (!ctx?.isTrial) return null;

  const days = ctx.daysRemaining;
  const urgency = days <= 1 ? "red" : days <= 3 ? "amber" : "blue";

  const colours = {
    red:   "border-red-500/30 bg-red-500/10 text-red-200",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    blue:  "border-blue-500/30 bg-blue-500/10 text-blue-200",
  }[urgency];

  const btnColours = {
    red:   "bg-red-500 hover:bg-red-600 text-white",
    amber: "bg-amber-500 hover:bg-amber-600 text-black",
    blue:  "bg-white hover:bg-zinc-200 text-black",
  }[urgency];

  return (
    <div className={`mb-6 rounded-2xl border px-4 py-3 ${colours}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-base">
            {days <= 1 ? "⚠️" : days <= 3 ? "🕐" : "👋"}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              {days <= 0
                ? "Your free trial has expired"
                : days === 1
                ? "Last day of your free trial"
                : `${days} day${days === 1 ? "" : "s"} left on your free trial`}
            </div>
            <div className="mt-0.5 text-xs opacity-80">
              You can browse everything on Authswap. Subscribe to comment, upvote, follow devs, join communities, and trade.
            </div>
          </div>
        </div>

        <Link
          href="/?subscribe=1&trial_upgrade=1"
          className={`shrink-0 rounded-xl px-4 py-2 text-xs font-semibold transition ${btnColours}`}
        >
          Subscribe now →
        </Link>
      </div>
    </div>
  );
}

// ─── TrialActionBlock ─────────────────────────────────────────────────────────
// Drop-in replacement for action buttons that trial users can't use.
// Shows the button as disabled with a tooltip-style upgrade prompt on click.

type ActionBlockProps = {
  children: React.ReactNode;
  isTrial: boolean;
  actionName?: string; // e.g. "comment", "upvote", "follow"
  className?: string;
};

export function TrialActionBlock({
  children,
  isTrial,
  actionName = "perform this action",
  className = "",
}: ActionBlockProps) {
  function handleClick(e: React.MouseEvent) {
    if (!isTrial) return;
    e.preventDefault();
    e.stopPropagation();
    // Redirect to subscribe
    window.location.href = "/?subscribe=1&trial_upgrade=1";
  }

  if (!isTrial) return <>{children}</>;

  return (
    <div
      className={`relative group cursor-pointer ${className}`}
      onClick={handleClick}
      title={`Subscribe to ${actionName}`}
    >
      {/* Overlay to block interaction */}
      <div className="absolute inset-0 z-10 rounded-xl" />

      {/* Dimmed children */}
      <div className="pointer-events-none opacity-50">
        {children}
      </div>

      {/* Hover tooltip */}
      <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-zinc-900 border border-white/10 px-2 py-1 text-[11px] text-zinc-300 opacity-0 group-hover:opacity-100 transition pointer-events-none z-20">
        Subscribe to {actionName}
      </div>
    </div>
  );
}
