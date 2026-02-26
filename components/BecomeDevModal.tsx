"use client";

import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { useRouter } from "next/navigation";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

export default function BecomeDevModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const { connection } = useConnection();
  const { publicKey, signMessage, sendTransaction } = useWallet();

  const [loading, setLoading] = useState<null | "signin" | "pay">(null);

  if (!open) return null;

  async function signIn() {
    if (!publicKey) return alert("Connect a wallet first.");
    if (!signMessage) return alert("This wallet does not support message signing.");

    setLoading("signin");
    try {
      const nonceRes = await fetch("/api/auth/nonce");
      const { message } = (await nonceRes.json()) as { message: string };

      const sig = await signMessage(new TextEncoder().encode(message));

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: publicKey.toBase58(),
          signature: bs58.encode(sig)
        })
      });

      if (!verifyRes.ok) {
        const err = await verifyRes.json().catch(() => ({}));
        alert(err?.error ?? "Sign-in failed.");
        return false;
      }

      return true;
    } catch (e) {
      console.error(e);
      alert("Sign-in failed.");
      return false;
    } finally {
      setLoading(null);
    }
  }

  async function payDevFee() {
    if (!publicKey) return alert("Connect a wallet first.");
    if (!sendTransaction) return alert("Wallet cannot send transactions.");

    const devTreasury = process.env.NEXT_PUBLIC_DEV_TREASURY_WALLET;
    const feeSol = Number(process.env.NEXT_PUBLIC_DEV_FEE_SOL ?? "0");

    if (!devTreasury) return alert("Missing NEXT_PUBLIC_DEV_TREASURY_WALLET (Vercel env).");
    if (!Number.isFinite(feeSol) || feeSol <= 0) return alert("Missing NEXT_PUBLIC_DEV_FEE_SOL.");

    const ok = await signIn();
    if (!ok) return;

    setLoading("pay");
    try {
      const toPubkey = new PublicKey(devTreasury);
      const lamports = Math.round(feeSol * 1_000_000_000);

      const latest = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: publicKey,
        recentBlockhash: latest.blockhash
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey,
          lamports
        })
      );

      const sig = await sendTransaction(tx, connection);

      // Server confirm (promotes to dev in Supabase)
      let lastErr: any = null;

      for (let i = 0; i < 12; i++) {
        const confirmRes = await fetch("/api/payments/confirm-dev-fee", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: sig })
        });

        if (confirmRes.ok) {
          await fetch("/api/context/refresh", { method: "POST" });
          onClose();
          router.push("/dashboard");
          return;
        }

        lastErr = await confirmRes.json().catch(() => ({}));
        await new Promise((r) => setTimeout(r, 1200));
      }

      alert(lastErr?.error ?? "Payment sent, but verification timed out. Try again in 10 seconds.");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Dev fee payment failed or cancelled.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Become a dev</h2>
            <p className="mt-1 text-sm text-zinc-300">
              Pay a one-time fee in SOL to unlock dev tools (no monthly subscription needed).
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

          <div className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/10 p-3">
            <div className="flex items-center justify-between text-sm text-fuchsia-200">
              <span>One-time dev fee</span>
              <span className="font-semibold">
                {process.env.NEXT_PUBLIC_DEV_FEE_SOL ?? "—"} SOL
              </span>
            </div>

            <p className="mt-2 text-xs text-fuchsia-200/80">
              You’ll sign a transaction sending SOL to Authswap. After confirmation, your wallet becomes a dev.
            </p>

            <button
              className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
              disabled={loading !== null || !publicKey}
              onClick={payDevFee}
            >
              {loading === "signin"
                ? "Signing in..."
                : loading === "pay"
                ? "Processing..."
                : "Pay dev fee"}
            </button>

            {!publicKey && (
              <p className="mt-2 text-xs text-zinc-500">Connect a wallet to continue.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
