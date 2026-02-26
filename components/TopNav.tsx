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

  useEffect(() => {
    // Pull role/sub status from Supabase via server route
    fetch("/api/context/refresh", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.ok ? setCtx(d) : null))
      .catch(() => null);
  }, []);

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
            <Tab href="/account" label="Account" active={pathname.startsWith("/account")} />
            <Tab href="/subscription" label="Subscription" active={pathname.startsWith("/subscription")} />
            {isDev && <Tab href="/dev/profile" label="Dev Profile" active={pathname.startsWith("/dev/profile")} />}
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
          <Tab href="/account" label="Account" active={pathname.startsWith("/account")} />
          <Tab href="/subscription" label="Subscription" active={pathname.startsWith("/subscription")} />
          {isDev && <Tab href="/dev/profile" label="Dev Profile" active={pathname.startsWith("/dev/profile")} />}
        </div>
      </div>
    </header>
  );
}
