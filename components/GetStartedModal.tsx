"use client";

import React from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function GetStartedModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { publicKey } = useWallet();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Connect wallet</h2>
            <p className="mt-1 text-sm text-zinc-300">
              Connect your Solana wallet to continue. Subscription comes next.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <WalletMultiButton className="!w-full !justify-center" />
          </div>

          {publicKey ? (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
              <p className="text-sm text-emerald-200">
                Connected: <span className="font-mono">{publicKey.toBase58()}</span>
              </p>
              <button
                className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200"
                onClick={onClose}
              >
                Continue
              </button>
              <p className="mt-2 text-xs text-emerald-200/80">
                Next step: sign-in + subscription payment (we’ll add this in Chunk 2/3).
              </p>
            </div>
          ) : (
            <p className="text-xs text-zinc-400">
              Supported: Phantom, Solflare, Trust, Coinbase Wallet, Backpack.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
