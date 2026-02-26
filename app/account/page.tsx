"use client";

import React from "react";
import TopNav from "@/components/TopNav";

export default function AccountPage() {
  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Wallet portfolio view (Phantom-style) comes next. This page is a placeholder for now.
        </p>
      </div>
    </main>
  );
}
