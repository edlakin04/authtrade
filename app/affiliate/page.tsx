"use client";

import React, { useEffect, useState, useCallback } from "react";
import TopNav from "@/components/TopNav";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type Earning = {
  id:                string;
  referee_wallet:    string;
  payment_signature: string;
  amount_sol:        number;
  amount_usd:        number | null;
  kind:              "user_sub" | "dev_sub";
  paid_out:          boolean;
  created_at:        string;
};

type Referral = {
  id:             string;
  referee_wallet: string;
  status:         "pending" | "converted";
  created_at:     string;
  converted_at:   string | null;
};

type Stats = {
  ok:                true;
  wallet:            string;
  referralLink:      string;
  totalReferrals:    number;
  pendingReferrals:  number;
  convertedReferrals: number;
  totalEarnedSol:    number;
  pendingPayoutSol:  number;
  paidOutSol:        number;
  userSubEarnings:   number;
  devSubEarnings:    number;
  solUsdPrice:       number | null;
  totalEarnedUsd:    number | null;
  pendingPayoutUsd:  number | null;
  paidOutUsd:        number | null;
  earnings:          Earning[];
  referrals:         Referral[];
};

function shortAddr(w: string) {
  if (!w) return "";
  return `${w.slice(0, 4)}\u2026${w.slice(-4)}`;
}

function fmtSol(n: number) {
  const formatted = n % 1 === 0 ? n.toString() : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return `${formatted} SOL`;
}

function fmtUsd(n: number | null) {
  if (n == null) return null;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AffiliatePage() {
  const [stats, setStats]       = useState<Stats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const [earningsTab, setEarningsTab] = useState<"earnings" | "referrals">("earnings");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/affiliate/stats", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Failed to load affiliate stats");
      setStats(json as Stats);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function copyLink() {
    if (!stats?.referralLink) return;
    try {
      await navigator.clipboard.writeText(stats.referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement("textarea");
      el.value = stats.referralLink;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />
      <div className="mx-auto max-w-3xl px-6 py-10">

        <div className="mb-8">
          <h1 className="text-2xl font-semibold">Affiliate</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Share your referral link. Earn SOL every time someone subscribes through it.
          </p>
        </div>

        {err && (
          <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            {err}
          </div>
        )}

        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse h-28 rounded-2xl bg-white/5" />
            ))}
          </div>
        )}

        {stats && !loading && (
          <>
            {/* Referral link */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-semibold text-zinc-300">Your referral link</h2>
                <span className="text-xs text-zinc-500">Share this to earn commission</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                  <p className="truncate font-mono text-xs text-zinc-300">{stats.referralLink}</p>
                </div>
                <button
                  onClick={copyLink}
                  className={["shrink-0 rounded-xl px-4 py-2.5 text-xs font-semibold transition",
                    copied ? "bg-emerald-500 text-white" : "bg-white text-black hover:bg-zinc-200"
                  ].join(" ")}
                >
                  {copied ? "Copied \u2713" : "Copy link"}
                </button>
              </div>
              <p className="mt-3 text-xs text-zinc-600">
                Anyone who clicks your link and subscribes within 30 days counts as your referral.
              </p>
            </div>

            {/* Commission rates */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-semibold text-zinc-300 mb-3">Commission rates</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                  <p className="text-xs text-zinc-500">User subscription</p>
                  <p className="mt-1 text-lg font-bold text-white">0.2 SOL</p>
                  <p className="text-xs text-zinc-600">per monthly payment</p>
                </div>
                <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                  <p className="text-xs text-zinc-500">Dev subscription</p>
                  <p className="mt-1 text-lg font-bold text-white">1 SOL</p>
                  <p className="text-xs text-zinc-600">per monthly payment</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-zinc-600">
                Commission is earned every time a referred user renews, not just their first payment.
              </p>
            </div>

            {/* Stats grid */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Total referrals",  value: stats.totalReferrals.toString(),
                  sub: `${stats.convertedReferrals} paid \u2022 ${stats.pendingReferrals} pending`, highlight: false },
                { label: "Total earned",     value: fmtSol(stats.totalEarnedSol),
                  sub: fmtUsd(stats.totalEarnedUsd) ?? "\u2014", highlight: false },
                { label: "Pending payout",   value: fmtSol(stats.pendingPayoutSol),
                  sub: fmtUsd(stats.pendingPayoutUsd) ?? "\u2014", highlight: stats.pendingPayoutSol > 0 },
                { label: "Paid out",         value: fmtSol(stats.paidOutSol),
                  sub: fmtUsd(stats.paidOutUsd) ?? "\u2014", highlight: false },
              ].map((s) => (
                <div key={s.label} className={["rounded-2xl border p-4",
                  s.highlight ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/10 bg-white/5"
                ].join(" ")}>
                  <p className="text-xs text-zinc-500">{s.label}</p>
                  <p className={["mt-1 text-xl font-bold",
                    s.highlight ? "text-emerald-400" : "text-white"
                  ].join(" ")}>{s.value}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{s.sub}</p>
                </div>
              ))}
            </div>

            {stats.solUsdPrice && (
              <p className="mt-2 text-right text-xs text-zinc-600">
                SOL = {fmtUsd(stats.solUsdPrice)} \u00b7 USD values are estimates
              </p>
            )}

            {/* Breakdown */}
            {(stats.userSubEarnings > 0 || stats.devSubEarnings > 0) && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 className="mb-3 text-sm font-semibold text-zinc-300">Earnings breakdown</h2>
                <div className="space-y-2">
                  {[
                    { label: "From user subscriptions", sol: stats.userSubEarnings },
                    { label: "From dev subscriptions",  sol: stats.devSubEarnings  },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-zinc-400">{row.label}</span>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-white">{fmtSol(row.sol)}</span>
                        {stats.solUsdPrice && (
                          <span className="ml-2 text-xs text-zinc-500">
                            {fmtUsd(Math.round(row.sol * stats.solUsdPrice! * 100) / 100)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* History */}
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
              <div className="flex border-b border-white/10">
                {(["earnings", "referrals"] as const).map((t) => (
                  <button key={t} onClick={() => setEarningsTab(t)}
                    className={["px-5 py-3 text-sm font-semibold transition border-b-2 -mb-px",
                      earningsTab === t ? "border-white text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"
                    ].join(" ")}>
                    {t === "earnings" ? `\ud83d\udcb0 Earnings (${stats.earnings.length})` : `\ud83d\udc65 Referrals (${stats.referrals.length})`}
                  </button>
                ))}
              </div>

              {earningsTab === "earnings" && (
                <div>
                  {stats.earnings.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-sm text-zinc-500">
                      No earnings yet. Share your referral link to get started.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {stats.earnings.map((e) => (
                        <div key={e.id} className="flex items-center justify-between gap-4 px-5 py-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={["rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                e.kind === "dev_sub" ? "bg-purple-500/20 text-purple-300" : "bg-blue-500/20 text-blue-300"
                              ].join(" ")}>{e.kind === "dev_sub" ? "Dev sub" : "User sub"}</span>
                              <span className={["rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                e.paid_out ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
                              ].join(" ")}>{e.paid_out ? "Paid out" : "Pending"}</span>
                            </div>
                            <p className="mt-1 font-mono text-xs text-zinc-400">
                              Referee: <Link href={`/user/${encodeURIComponent(e.referee_wallet)}`} className="hover:text-white transition">{shortAddr(e.referee_wallet)}</Link>
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold text-white">{fmtSol(e.amount_sol)}</p>
                            {e.amount_usd !== null && <p className="text-xs text-zinc-500">{fmtUsd(e.amount_usd)}</p>}
                            <p className="text-xs text-zinc-600">{timeAgo(e.created_at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {earningsTab === "referrals" && (
                <div>
                  {stats.referrals.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-sm text-zinc-500">No referrals yet.</div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {stats.referrals.map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-4 px-5 py-3">
                          <div className="min-w-0">
                            <span className={["rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              r.status === "converted" ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-500/20 text-zinc-400"
                            ].join(" ")}>{r.status === "converted" ? "Converted" : "Pending"}</span>
                            <p className="mt-1 font-mono text-xs text-zinc-400">
                              <Link href={`/user/${encodeURIComponent(r.referee_wallet)}`} className="hover:text-white transition">{shortAddr(r.referee_wallet)}</Link>
                            </p>
                          </div>
                          <div className="text-right shrink-0 text-xs text-zinc-500">
                            <p>Clicked {timeAgo(r.created_at)}</p>
                            {r.converted_at && <p className="text-emerald-400">Paid {timeAgo(r.converted_at)}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Payout note */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs text-zinc-500">
                <span className="font-semibold text-zinc-300">Payouts</span> \u2014 Pending SOL is sent manually by Authswap.
                Payouts are processed periodically. All amounts are tracked on-chain via verified transaction signatures
                so nothing can be fabricated.
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
