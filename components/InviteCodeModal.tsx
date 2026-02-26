"use client";

import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { useRouter } from "next/navigation";

export default function InviteCodeModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { publicKey, signMessage } = useWallet();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState<null | "signin" | "redeem">(null);

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

  async function redeem() {
    const trimmed = code.trim();
    if (!trimmed) return alert("Enter your invite code.");

    // Ensure signed in first (needed for server to know wallet)
    const ok = await signIn();
    if (!ok) return;

    setLoading("redeem");
    try {
      const res = await fetch("/api/dev/redeem-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error ?? "Invite code failed.");
        return;
      }

      // Refresh role cookie (dev) + sub cookie if any
      await fetch("/api/context/refresh", { method: "POST" });

      onClose();
      router.push("/dashboard");
    } catch (e) {
      console.error(e);
      alert("Invite code failed. Try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Invite code</h2>
            <p className="mt-1 text-sm text-zinc-300">
              Dev access via one-time invite code. Connect wallet, enter code, and redeem.
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

          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <label className="text-xs text-zinc-400">Invite code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter invite code"
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600"
            />
            <button
              className="mt-3 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60"
              disabled={loading !== null || !publicKey}
              onClick={redeem}
            >
              {loading === "signin"
                ? "Signing in..."
                : loading === "redeem"
                ? "Redeeming..."
                : "Redeem invite code"}
            </button>

            {!publicKey && (
              <p className="mt-2 text-xs text-zinc-500">Connect a wallet to redeem.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
