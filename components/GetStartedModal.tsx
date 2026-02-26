"use client";

import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { useRouter } from "next/navigation";

export default function GetStartedModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { publicKey, signMessage } = useWallet();

  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSignIn() {
    if (!publicKey) {
      alert("Connect a wallet first.");
      return;
    }
    if (!signMessage) {
      alert("This wallet does not support message signing.");
      return;
    }

    setLoading(true);
    try {
      // 1) Get nonce + message from server
      const nonceRes = await fetch("/api/auth/nonce", { method: "GET" });
      if (!nonceRes.ok) {
        alert("Failed to start sign-in. Try again.");
        return;
      }
      const { message } = (await nonceRes.json()) as { message: string };

      // 2) Ask wallet to sign the message bytes
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(messageBytes);

      // 3) Send signature to server to verify & set session cookie
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: publicKey.toBase58(),
          signature: bs58.encode(signatureBytes)
        })
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({}));
        alert(err?.error ?? "Sign-in failed.");
        return;
      }

      onClose();
      router.push("/dashboard");
    } catch (e) {
      alert("Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Connect wallet</h2>
            <p className="mt-1 text-sm text-zinc-300">
              Connect your Solana wallet, then sign in to continue. This does not approve any transactions.
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
                className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
                onClick={handleSignIn}
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>

              <p className="mt-2 text-xs text-emerald-200/80">
                Next: we’ll add subscription payment + access gating.
              </p>
            </div>
          ) : (
            <p className="text-xs text-zinc-400">
              Supported: Phantom, Solflare, Trust, Coinbase Wallet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
