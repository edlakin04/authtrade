"use client";

import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useRouter } from "next/navigation";

// ─── UpgradeModal ─────────────────────────────────────────────────────────────
// Shown to trial users who click "Subscribe" or try a blocked action.
// Skips wallet connect / sign-in entirely — the user is already signed in.
// Goes straight to: feature summary → pay → confirm → redirect to dashboard.

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function UpgradeModal({ open, onClose }: Props) {
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!open) return null;

  const priceSol = Number(process.env.NEXT_PUBLIC_SUB_PRICE_SOL ?? "0");
  const treasury = process.env.NEXT_PUBLIC_TREASURY_WALLET ?? "";

  async function handleSubscribe() {
    if (!publicKey) {
      setErr("Wallet not connected. Please connect your wallet first.");
      return;
    }
    if (!sendTransaction) {
      setErr("This wallet cannot send transactions.");
      return;
    }
    if (!treasury) {
      setErr("Missing treasury wallet config.");
      return;
    }
    if (!Number.isFinite(priceSol) || priceSol <= 0) {
      setErr("Missing subscription price config.");
      return;
    }

    setErr(null);
    setLoading(true);

    try {
      const toPubkey = new PublicKey(treasury);
      const lamports = Math.round(priceSol * 1_000_000_000);

      const latest = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: publicKey,
        recentBlockhash: latest.blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey,
          lamports,
        })
      );

      // This opens the wallet popup for signing
      const sig = await sendTransaction(tx, connection);

      setLoading(false);
      setConfirming(true);

      // Verify with retries
      let lastErr: any = null;
      for (let i = 0; i < 12; i++) {
        const res = await fetch("/api/payments/confirm-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: sig }),
        });

        if (res.ok) {
          // Refresh context so new sub cookie is issued
          await fetch("/api/context/refresh", { method: "POST" });
          onClose();
          // Full navigation so middleware sees the new paid sub cookie
          window.location.href = "/dashboard";
          return;
        }

        lastErr = await res.json().catch(() => ({}));
        await new Promise((r) => setTimeout(r, 1200));
      }

      setConfirming(false);
      setErr(
        lastErr?.error ??
          "Payment sent but verification timed out. Wait 10s and refresh."
      );
    } catch (e: any) {
      setLoading(false);
      setConfirming(false);
      const msg =
        e?.message ||
        e?.toString?.() ||
        "Payment failed. Check your wallet and try again.";
      // Ignore user rejection silently
      if (!msg.toLowerCase().includes("reject") && !msg.toLowerCase().includes("cancel")) {
        setErr(msg);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">
              {confirming ? "Confirming payment…" : "Upgrade to full access"}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {confirming
                ? "Your transaction was sent. Waiting for confirmation."
                : "Your free trial doesn't include this feature."}
            </p>
          </div>
          {!loading && !confirming && (
            <button
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* Confirming spinner */}
        {confirming && (
          <div className="mt-6 flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="text-xs text-zinc-500">This usually takes a few seconds…</p>
          </div>
        )}

        {/* Main content */}
        {!confirming && (
          <>
            {/* What you unlock */}
            <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">
                Full access unlocks
              </p>
              <ul className="space-y-2">
                {[
                  "Dashboard & following feed",
                  "Join & post in communities",
                  "Comment & upvote coins",
                  "Vote on polls",
                  "Follow devs & leave reviews",
                  "Jupiter swap inside Authswap",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-zinc-300">
                    <span className="text-emerald-400 text-xs">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Price + CTA */}
            <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4">
              <div className="flex items-center justify-between text-emerald-200">
                <span className="text-sm font-semibold">Monthly subscription</span>
                <span className="text-lg font-bold">{priceSol} SOL</span>
              </div>
              <p className="mt-1 text-xs text-emerald-200/70">
                30 days full access. Sends SOL to Authswap treasury.
              </p>

              <button
                className="mt-4 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60 transition"
                disabled={loading}
                onClick={handleSubscribe}
              >
                {loading ? "Opening wallet…" : `Subscribe — ${priceSol} SOL`}
              </button>
            </div>

            {/* Error */}
            {err && (
              <p className="mt-3 text-xs text-red-400 text-center">{err}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
