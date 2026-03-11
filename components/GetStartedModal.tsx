"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { useRouter, useSearchParams } from "next/navigation";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

type Step = "connect" | "signin" | "subscribe";
type SubscribeReason = "new" | "expired";

export default function GetStartedModal({
  open,
  onClose,
  intent = null,
}: {
  open: boolean;
  onClose: () => void;
  intent?: "subscribe" | "trial" | "upgrade" | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const { connection } = useConnection();
  const { publicKey, signMessage, sendTransaction } = useWallet();

  const [loading, setLoading] = useState<null | "signin" | "pay" | "trial">(null);
  const [step, setStep] = useState<Step>("connect");

  // ✅ new vs expired messaging
  const [subscribeReason, setSubscribeReason] = useState<SubscribeReason>("new");
  const [expiredAt, setExpiredAt] = useState<string | null>(null);

  // Trial state (read from server after sign-in)
  const [trialStatus, setTrialStatus] = useState<{
    trialEligible: boolean;
    trialActive: boolean;
    trialExpired: boolean;
    daysRemaining: number;
  } | null>(null);

  const shouldPromptSubscribe = useMemo(() => params.get("subscribe") === "1", [params]);

  // When modal opens, silently check if already signed in.
  // Uses GET /api/me (read-only, no cookie side-effects) to avoid
  // accidentally redirecting users who have stale/expired cookies.
  useEffect(() => {
    if (!open) return;

    (async () => {
      try {
        // Step 1: lightweight session check — does NOT set any cookies
        const meRes = await fetch("/api/me", { cache: "no-store" });
        if (!meRes.ok) return;
        const me = await meRes.json().catch(() => null);
        if (!me?.wallet) return; // no valid session — stay on connect step

        // Step 2: now that we know they're signed in, refresh context
        const ctxRes = await fetch("/api/context/refresh", { method: "POST" });
        if (!ctxRes.ok) return;

        const ctx = await ctxRes.json().catch(() => null);
        if (!ctx?.ok) return;

        // Already signed in with full access — go to dashboard
        if (ctx.role === "dev" || ctx.role === "admin" || ctx.subscribedActive) {
          onClose();
          router.push("/dashboard");
          return;
        }

        // Active trial — go to dashboard (trial users can see everything now)
        if (ctx.isTrial) {
          onClose();
          router.push("/dashboard");
          return;
        }

        // Signed in but no sub/trial — jump straight to subscribe step
        const [statusRes, trialRes] = await Promise.all([
          fetch(`/api/subscription/status?wallet=${encodeURIComponent(ctx.wallet ?? "")}`, { cache: "no-store" }),
          fetch("/api/auth/trial", { cache: "no-store" }),
        ]);

        if (statusRes.ok) {
          const status = await statusRes.json().catch(() => null);
          if (status?.ok && !status.subscribedActive && status.hasEverSubscribed && status.expiresAt) {
            setSubscribeReason("expired");
            setExpiredAt(status.expiresAt);
          }
        }

        if (trialRes.ok) {
          const t = await trialRes.json().catch(() => null);
          if (t?.signedIn) {
            setTrialStatus({
              trialEligible: t.trialEligible,
              trialActive:   t.trialActive,
              trialExpired:  t.trialExpired,
              daysRemaining: t.daysRemaining,
            });
          }
        }

        setStep("subscribe");
      } catch {
        // silent — stay on connect step
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function handleSignInThenRefreshContext() {
    if (!publicKey) return alert("Connect a wallet first.");
    if (!signMessage) return alert("This wallet does not support message signing.");

    setLoading("signin");

    try {
      // 1) Get nonce + message
      const nonceRes = await fetch("/api/auth/nonce");
      if (!nonceRes.ok) {
        alert("Failed to start sign-in. Try again.");
        return;
      }
      const { message } = (await nonceRes.json()) as { message: string };

      // 2) Sign message
      const signatureBytes = await signMessage(new TextEncoder().encode(message));

      // 3) Verify on server (sets session cookie)
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

      // 4) Refresh context (role + subscription) from your server
      const ctxRes = await fetch("/api/context/refresh", { method: "POST" });

      // If ctx refresh fails, still allow subscribe step
      if (!ctxRes.ok) {
        setSubscribeReason("new");
        setExpiredAt(null);
        setStep("subscribe");
        return;
      }

      const ctx = (await ctxRes.json().catch(() => null)) as
        | { ok: true; role: "user" | "dev" | "admin"; subscribedActive: boolean; isTrial: boolean; trialActive: boolean; trialExpired: boolean; trialEligible: boolean; daysRemaining: number }
        | null;

      // If dev/admin or already subscribed → go dashboard
      if (ctx?.ok && (ctx.role === "dev" || ctx.role === "admin" || ctx.subscribedActive)) {
        onClose();
        router.push("/dashboard");
        return;
      }

      // If trial is currently active → go to dashboard
      if (ctx?.ok && ctx.isTrial) {
        onClose();
        router.push("/dashboard");
        return;
      }

      // Check subscription history + trial status in parallel
      const [statusRes, trialRes] = await Promise.all([
        fetch(`/api/subscription/status?wallet=${encodeURIComponent(publicKey.toBase58())}`, { cache: "no-store" }),
        fetch("/api/auth/trial", { cache: "no-store" }),
      ]);

      if (statusRes.ok) {
        const status = (await statusRes.json().catch(() => null)) as
          | { ok: true; subscribedActive: boolean; expiresAt: string | null; hasEverSubscribed: boolean }
          | null;
        if (status?.ok && !status.subscribedActive && status.hasEverSubscribed && status.expiresAt) {
          setSubscribeReason("expired");
          setExpiredAt(status.expiresAt);
        } else {
          setSubscribeReason("new");
          setExpiredAt(null);
        }
      } else {
        setSubscribeReason("new");
        setExpiredAt(null);
      }

      if (trialRes.ok) {
        const t = await trialRes.json().catch(() => null);
        if (t?.signedIn) {
          setTrialStatus({
            trialEligible: t.trialEligible,
            trialActive:   t.trialActive,
            trialExpired:  t.trialExpired,
            daysRemaining: t.daysRemaining,
          });
        }
      }

      setStep("subscribe");
    } catch (e) {
      console.error("Sign-in error:", e);
      alert("Sign-in failed. Try again.");
    } finally {
      setLoading(null);
    }
  }

  async function handleStartTrial() {
    if (!publicKey) return alert("Connect a wallet first.");
    setLoading("trial");
    try {
      const res = await fetch("/api/auth/trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (json?.code === "TRIAL_ALREADY_USED") {
          alert("You've already used your free trial. Please subscribe to continue.");
        } else if (json?.code === "ALREADY_SUBSCRIBED") {
          router.push("/dashboard");
        } else {
          alert(json?.error ?? "Failed to start trial. Try again.");
        }
        return;
      }

      // Trial activated — refresh context then navigate to dashboard
      // Use window.location.href so the browser sends the new trial cookie to middleware
      await fetch("/api/context/refresh", { method: "POST" });
      onClose();
      window.location.href = "/dashboard";
    } catch (e: any) {
      alert(e?.message ?? "Failed to start trial.");
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

      // Verify server-side with retries (writes to Supabase + updates access)
      let lastErr: any = null;

      for (let i = 0; i < 12; i++) {
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

      alert(lastErr?.error ?? "Payment sent, but verification timed out. Try again in 10 seconds.");
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

  const subscribeTitle =
    intent === "upgrade"       ? "Upgrade to full access" :
    subscribeReason === "expired" ? "Subscription expired"  : "Get started";

  const subscribeDesc =
    intent === "upgrade"          ? "Subscribe to unlock all features." :
    subscribeReason === "expired" ? "Your 30 days are up. Renew now to regain access." :
                                    "Choose how you'd like to access Authswap.";

  const subscribeBtn =
    subscribeReason === "expired" ? "Renew subscription" : "Subscribe now";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">
              {step === "connect" && "Connect wallet"}
              {step === "signin" && "Sign in"}
              {step === "subscribe" && subscribeTitle}
            </h2>
            <p className="mt-1 text-sm text-zinc-300">
              {step === "connect" && "Connect your Solana wallet to continue."}
              {step === "signin" && "Sign a message to prove wallet ownership. No transactions."}
              {step === "subscribe" && subscribeDesc}
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
                await handleSignInThenRefreshContext();
              }}
            >
              {loading === "signin" ? "Signing in..." : "Sign in"}
            </button>
          ) : (
            <div className="space-y-3">
              {/* Paid subscription */}
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
                <div className="flex items-center justify-between text-sm text-emerald-200">
                  <span>Monthly — full access</span>
                  <span className="font-semibold">
                    {process.env.NEXT_PUBLIC_SUB_PRICE_SOL ?? "—"} SOL
                  </span>
                </div>

                {subscribeReason === "expired" && expiredAt && (
                  <p className="mt-2 text-xs text-emerald-200/80">
                    Expired on: {new Date(expiredAt).toLocaleString()}
                  </p>
                )}

                <p className="mt-2 text-xs text-emerald-200/80">
                  Unlocks everything — dashboard, communities, swaps, reviews — for 30 days.
                </p>

                <button
                  className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
                  disabled={loading === "pay"}
                  onClick={handleStartSubscription}
                >
                  {loading === "pay" ? "Processing..." : subscribeBtn}
                </button>
              </div>

              {/* Free trial — only if eligible and not an upgrade prompt */}
              {trialStatus?.trialEligible && intent !== "upgrade" && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between text-sm text-zinc-200">
                    <span>7-day free trial</span>
                    <span className="text-xs text-zinc-400">Browse only · Free</span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-400">
                    View coins and dev profiles only. No dashboard, communities, or actions. One trial per wallet, forever.
                  </p>
                  <button
                    className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60 transition"
                    disabled={loading === "trial"}
                    onClick={handleStartTrial}
                  >
                    {loading === "trial" ? "Activating…" : "Start free trial"}
                  </button>
                </div>
              )}

              {/* Trial already used */}
              {trialStatus?.trialExpired && (
                <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/40 px-3 py-2 text-xs text-zinc-500">
                  You’ve used your free trial. Subscribe above to continue.
                </div>
              )}

              {/* Upgrade prompt */}
              {intent === "upgrade" && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  Your free trial doesn’t include this feature. Subscribe for full access.
                </div>
              )}
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
