"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type Ctx = {
  ok: true;
  role: "user" | "dev" | "admin";
  subscribedActive: boolean;
  paidUntilMs: number;
};

function Tab({
  href,
  label,
  active
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "rounded-xl px-3 py-2 text-sm transition",
        active
          ? "bg-white text-black"
          : "text-zinc-300 hover:bg-white/5 hover:text-white"
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [unseenCount, setUnseenCount] = useState(0);
  const [collabPendingCount, setCollabPendingCount] = useState(0);

  useEffect(() => {
    fetch("/api/context/refresh", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.ok ? setCtx(d) : null))
      .catch(() => null);
  }, []);

  // Poll for unseen notifications every 30s
  useEffect(() => {
    let cancelled = false;

    async function checkUnseen() {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setUnseenCount(json?.unseenCount ?? 0);
      } catch {
        // silently ignore
      }
    }

    checkUnseen();
    const interval = setInterval(checkUnseen, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Poll for pending collab invites every 30s (only when user is a dev)
  useEffect(() => {
    let cancelled = false;

    async function checkCollab() {
      try {
        const res = await fetch("/api/collab/me", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setCollabPendingCount(json?.pendingInviteCount ?? 0);
      } catch {
        // silently ignore
      }
    }

    // Only poll if we know the user is a dev
    if (ctx?.role === "dev" || ctx?.role === "admin") {
      checkCollab();
      const interval = setInterval(checkCollab, 30_000);
      return () => { cancelled = true; clearInterval(interval); };
    }
  }, [ctx?.role]);

  const isDev = ctx?.role === "dev" || ctx?.role === "admin";

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/70 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-base font-semibold text-white">
            Auth<span className="text-gradient">swap</span>
          </Link>

          <div className="hidden items-center gap-2 sm:flex">
            <Tab href="/dashboard" label="Dashboard" active={pathname.startsWith("/dashboard")} />
            <Tab href="/coins" label="Coins" active={pathname.startsWith("/coins")} />

            {/* Account tab — red dot for unseen notifications */}
            <Link
              href="/account"
              className={[
                "relative rounded-xl px-3 py-2 text-sm transition",
                pathname.startsWith("/account")
                  ? "bg-white text-black"
                  : "text-zinc-300 hover:bg-white/5 hover:text-white"
              ].join(" ")}
            >
              Account
              {unseenCount > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-zinc-950" />
              )}
            </Link>

            <Tab href="/subscription" label="Subscription" active={pathname.startsWith("/subscription")} />

            {/* Dev Profile tab — red dot for pending collab invites */}
            {isDev && (
              <Link
                href="/dev/profile"
                className={[
                  "relative rounded-xl px-3 py-2 text-sm transition",
                  pathname.startsWith("/dev/profile")
                    ? "bg-white text-black"
                    : "text-zinc-300 hover:bg-white/5 hover:text-white"
                ].join(" ")}
              >
                Dev Profile
                {collabPendingCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-zinc-950" />
                )}
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {ctx ? (
            <div className="hidden rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300 md:block">
              {ctx.role.toUpperCase()} • {ctx.subscribedActive ? "SUB ACTIVE" : "NO SUB"}
            </div>
          ) : (
            <div className="hidden rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-400 md:block">
              Loading…
            </div>
          )}

          <button
            onClick={() => router.push("/")}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 hover:bg-white/10"
            title="Back to landing"
          >
            Home
          </button>
        </div>
      </div>

      {/* Mobile tabs */}
      <div className="sm:hidden">
        <div className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-6 pb-4">
          <Tab href="/dashboard" label="Dashboard" active={pathname.startsWith("/dashboard")} />
          <Tab href="/coins" label="Coins" active={pathname.startsWith("/coins")} />

          {/* Account tab — red dot for unseen notifications */}
          <Link
            href="/account"
            className={[
              "relative rounded-xl px-3 py-2 text-sm transition",
              pathname.startsWith("/account")
                ? "bg-white text-black"
                : "text-zinc-300 hover:bg-white/5 hover:text-white"
            ].join(" ")}
          >
            Account
            {unseenCount > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-zinc-950" />
            )}
          </Link>

          <Tab href="/subscription" label="Subscription" active={pathname.startsWith("/subscription")} />

          {/* Dev Profile tab — red dot for pending collab invites */}
          {isDev && (
            <Link
              href="/dev/profile"
              className={[
                "relative rounded-xl px-3 py-2 text-sm transition",
                pathname.startsWith("/dev/profile")
                  ? "bg-white text-black"
                  : "text-zinc-300 hover:bg-white/5 hover:text-white"
              ].join(" ")}
            >
              Dev Profile
              {collabPendingCount > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-zinc-950" />
              )}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
