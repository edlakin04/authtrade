"use client";

import React, { useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { useRouter, useSearchParams } from "next/navigation";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

type Step = "connect" | "signin" | "subscribe";

export default function GetStartedModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const { connection } = useConnection();
  const { publicKey, signMessage, sendTransaction } = useWallet();

  const [loading, setLoading] = useState<null | "signin" | "pay">(null);
  const [step, setStep] = useState<Step>("connect");

  const shouldPromptSubscribe = useMemo(() => params.get("subscribe") === "1", [params]);

  if (!open) return null;

  async function handleSignIn() {
    if (!publicKey) return alert("Connect a wallet first.");
    if (!signMessage) return alert("This wallet does not support message signing.");

    setLoading("signin");
    try {
      const nonceRes = await fetch("/api/auth/nonce");
      if (!nonceRes.ok) {
        alert("Failed to start sign-in. Try again.");
        return;
      }

      const { message } = (await nonceRes.json()) as { message: string };
      const signatureBytes = await signMessage(new TextEncoder().encode(message));

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

      setStep("subscribe");
    } catch (e) {
      console.error("Sign-in error:", e);
      alert("Sign-in failed. Try again.");
    } finally {
      setLoading(null);
    }
  }

  async function handleStartSubscription() {
    if (!publicKey) return alert("Connect a wallet first.");
    if (!sendTransaction) return alert("Wallet cannot send transactions.");

    const treasury = process.env.NEXT_PUBLIC_TREASURY_WALLET;
    const priceSol = Number(process.env.NEXT_PUBLIC_SUB_PRICE_SOL ?? "0");

    if (!treasury) return alert("Missing NEXT_PUBLIC_TREASURY_WALLET (set in Vercel env).");
    if (!Number.isFinite(priceSol) || priceSol <= 0) return alert("Missing NEXT_PUBLIC_SUB_PRICE_SOL.");

    setLoading("pay");

    try {
      const toPubkey = new PublicKey(treasury);
      const lamports = Math.round(priceSol * 1_000_000_000);

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey,
          lamports
        })
      );

      // Wallet signs + sends
      const sig = await sendTransaction(tx, connection);

      // Do NOT confirm client-side (often flaky). Verify server-side with retries.
      let lastErr: any = null;

      for (let i = 0; i < 10; i++) {
        const confirmRes = await fetch("/api/payments/confirm-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: sig })
        });

        if (confirmRes.ok) {
          onClose();
          router.push("/dashboard");
          return;
        }

        lastErr = await confirmRes.json().catch(() => ({}));
        await new Promise((r) => setTimeout(r, 1200));
      }

      alert(
        lastErr?.error ??
          "Payment sent, but verification timed out. Wait 10 seconds and try again."
      );
    } catch (e: any) {
      console.error("Subscription payment error:", e);
      const msg =
        e?.message ||
        e?.toString?.() ||
        "Payment failed (wallet rejected, RPC issue, or not enough SOL for fees).";
      alert(msg);
    } finally {
      setLoading(null);
    }
  }

  const connected = !!publicKey;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">
              {step === "connect" && "Connect wallet"}
              {step === "signin" && "Sign in"}
              {step === "subscribe" && "Start subscription"}
            </h2>
            <p className="mt-1 text-sm text-zinc-300">
              {step === "connect" && "Connect your Solana wallet to continue."}
              {step === "signin" && "Sign a message to prove wallet ownership. No transactions."}
              {step === "subscribe" && "Pay the monthly fee in SOL to unlock Authswap."}
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

          {connected && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-zinc-400">Connected</p>
              <p className="mt-1 break-all font-mono text-xs text-zinc-200">
                {publicKey!.toBase58()}
              </p>
            </div>
          )}

          {!connected ? (
            <p className="text-xs text-zinc-400">
              Supported: Phantom, Solflare, Trust, Coinbase Wallet.
            </p>
          ) : step !== "subscribe" ? (
            <button
              className="w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
              disabled={loading === "signin"}
              onClick={async () => {
                setStep("signin");
                await handleSignIn();
              }}
            >
              {loading === "signin" ? "Signing in..." : "Sign in"}
            </button>
          ) : (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
              <div className="flex items-center justify-between text-sm text-emerald-200">
                <span>Monthly</span>
                <span className="font-semibold">
                  {process.env.NEXT_PUBLIC_SUB_PRICE_SOL ?? "—"} SOL
                </span>
              </div>

              <p className="mt-2 text-xs text-emerald-200/80">
                You’ll sign a transaction sending SOL to Authswap. This unlocks access for 30 days.
              </p>

              <button
                className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                disabled={loading === "pay"}
                onClick={handleStartSubscription}
              >
                {loading === "pay" ? "Processing..." : "Start subscription"}
              </button>
            </div>
          )}
        </div>

        {shouldPromptSubscribe && (
          <p className="mt-4 text-xs text-zinc-500">
            You tried to open a locked page. Subscribe to continue.
          </p>
        )}
      </div>
    </div>
  );
}
