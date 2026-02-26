"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import TopNav from "@/components/TopNav";
import JupiterSwapWidget from "@/components/JupiterSwapWidget";

export default function TradeInner() {
  const sp = useSearchParams();
  const inputMint = sp.get("inputMint") ?? undefined;
  const outputMint = sp.get("outputMint") ?? undefined;

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Trade</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Swap using Jupiter inside Authswap. Your trade may generate referral fees for the platform.
        </p>

        <div className="mt-6">
          <JupiterSwapWidget inputMint={inputMint} outputMint={outputMint} />
        </div>
      </div>
    </main>
  );
}
