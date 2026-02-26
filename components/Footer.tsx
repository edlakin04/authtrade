"use client";

import React from "react";

export default function Footer({
  onInviteCode,
  onBecomeDev
}: {
  onInviteCode: () => void;
  onBecomeDev: () => void;
}) {
  return (
    <footer className="mt-16 border-t border-white/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-8 text-sm text-zinc-400">
        <p>© {new Date().getFullYear()} Authswap</p>
        <div className="flex items-center gap-3">
          <button
            onClick={onInviteCode}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-zinc-200 hover:bg-white/10"
          >
            Invite code
          </button>
          <button
            onClick={onBecomeDev}
            className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-2 text-fuchsia-200 hover:bg-fuchsia-400/20"
          >
            Become a dev
          </button>
        </div>
      </div>
    </footer>
  );
}
