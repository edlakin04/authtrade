"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

type AuctionStatus = "scheduled" | "live" | "awaiting_payment" | "completed" | "rolled_over" | "cancelled";

type BiddingAdStatus = {
  ok: true;
  targetDate: string;
  schedule: {
    entryOpensAt: string;
    auctionStartsAt: string;
    auctionEndsAt: string;
  };
  pricing: {
    entryFeeSol: number;
    entryFeeLamports: number;
  };
  eligibility: {
    isEligible: boolean;
    avgRating: number | null;
    reviewCount: number;
  };
  ui: {
    entryOpen: boolean;
    auctionLive: boolean;
    auctionClosed: boolean;
    hasEntered: boolean;
    iWon: boolean;
    state: "can_enter" | "entered" | "auction_live" | "won" | "lost" | "closed";
  };
  auction: {
    id: string;
    target_date: string;
    entry_opens_at: string;
    auction_starts_at: string;
    auction_ends_at: string;
    status: AuctionStatus;
    highest_bid_lamports: number | null;
    highest_bidder_wallet: string | null;
    highest_bid_entry_id: string | null;
    last_bid_at: string | null;
    bid_count: number;
    created_at: string;
    updated_at: string;
    auction_live?: boolean;
    auction_closed?: boolean;
    next_min_bid_lamports?: number;
    next_min_bid_sol?: number;
    extension_window_seconds?: number;
  };
  entry: {
    id: string;
    auction_id: string;
    target_date: string;
    dev_wallet: string;
    coin_id: string;
    banner_path: string;
    coin_title: string | null;
    token_address: string | null;
    entry_fee_lamports: number;
    entry_payment_status: "pending" | "paid" | "failed" | "refunded";
    created_at: string;
    updated_at: string;
  } | null;
  winner: {
    id: string;
    auction_id: string;
    target_date: string;
    entry_id: string;
    bid_id: string;
    dev_wallet: string;
    coin_id: string;
    banner_path: string;
    amount_lamports: number;
    ad_starts_at: string;
    ad_ends_at: string;
    payment_confirmed_at: string | null;
    created_at: string;
  } | null;
  ownedCoins: Array<{
    id: string;
    wallet: string;
    token_address: string;
    title: string | null;
    description: string | null;
    created_at: string;
  }>;
};

type BidRow = {
  id: string;
  auction_id: string;
  target_date: string;
  entry_id: string;
  bidder_wallet: string;
  amount_lamports: number;
  placed_at: string;
  created_at: string;
};

type BidsResponse = {
  ok: true;
  targetDate: string;
  now: string;
  auction: BiddingAdStatus["auction"];
  entry: BiddingAdStatus["entry"];
  winner: BiddingAdStatus["winner"];
  bids: BidRow[];
};

function shortAddr(s: string | null | undefined) {
  if (!s) return "—";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function fmtSolFromLamports(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n / 1_000_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  })} SOL`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function fmtCountdown(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "00:00:00";

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  return [hours, mins, secs].map((v) => String(v).padStart(2, "0")).join(":");
}

function statusPillText(status: AuctionStatus) {
  if (status === "scheduled") return "Scheduled";
  if (status === "live") return "Live";
  if (status === "awaiting_payment") return "Awaiting payment";
  if (status === "completed") return "Completed";
  if (status === "rolled_over") return "Rolled over";
  return "Cancelled";
}

export default function AuctionPage({
  params
}: {
  params: Promise<{ targetDate: string }>;
}) {
  const [targetDate, setTargetDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<BiddingAdStatus | null>(null);

  const [bidsLoading, setBidsLoading] = useState(true);
  const [bidsErr, setBidsErr] = useState<string | null>(null);
  const [bidsData, setBidsData] = useState<BidsResponse | null>(null);

  const [nowMs, setNowMs] = useState(Date.now());
  const [bidAmount, setBidAmount] = useState<string>("");
  const [bidBusy, setBidBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await params;
      setTargetDate(p.targetDate);
    })();
  }, [params]);

  async function loadPage(date: string) {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/dev/bidding-ad?target_date=${encodeURIComponent(date)}`, {
        cache: "no-store"
      });
      const json = (await res.json().catch(() => null)) as BiddingAdStatus | null;

      if (!res.ok) {
        throw new Error((json as any)?.error || "Failed to load auction");
      }

      setData(json);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load auction");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadBids(date: string, keepExisting = true) {
    if (!keepExisting) setBidsLoading(true);
    setBidsErr(null);

    try {
      const res = await fetch(`/api/dev/bidding-ad/bids?target_date=${encodeURIComponent(date)}`, {
        cache: "no-store"
      });
      const json = (await res.json().catch(() => null)) as BidsResponse | null;

      if (!res.ok) {
        throw new Error((json as any)?.error || "Failed to load bids");
      }

      setBidsData(json);
    } catch (e: any) {
      setBidsErr(e?.message ?? "Failed to load bids");
      if (!keepExisting) setBidsData(null);
    } finally {
      setBidsLoading(false);
    }
  }

  async function refreshAll(date: string, keepExistingBids = true) {
    await Promise.all([loadPage(date), loadBids(date, keepExistingBids)]);
  }

  useEffect(() => {
    if (!targetDate) return;
    refreshAll(targetDate, false);
  }, [targetDate]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!targetDate) return;
    if (data?.auction?.status !== "live" && bidsData?.auction?.status !== "live") return;

    const t = setInterval(() => {
      loadBids(targetDate, true);
    }, 5000);

    return () => clearInterval(t);
  }, [targetDate, data?.auction?.status, bidsData?.auction?.status]);

  const displayAuction = bidsData?.auction ?? data?.auction ?? null;
  const displayEntry = bidsData?.entry ?? data?.entry ?? null;
  const displayWinner = bidsData?.winner ?? data?.winner ?? null;
  const displayBids = bidsData?.bids ?? [];

  const auctionStartsAtMs = useMemo(() => {
    const iso = displayAuction?.auction_starts_at || data?.schedule?.auctionStartsAt;
    return iso ? Date.parse(iso) : NaN;
  }, [displayAuction?.auction_starts_at, data?.schedule?.auctionStartsAt]);

  const auctionEndsAtMs = useMemo(() => {
    const iso = displayAuction?.auction_ends_at || data?.schedule?.auctionEndsAt;
    return iso ? Date.parse(iso) : NaN;
  }, [displayAuction?.auction_ends_at, data?.schedule?.auctionEndsAt]);

  const toStartMs = auctionStartsAtMs - nowMs;
  const toEndMs = auctionEndsAtMs - nowMs;

  const currentHighestSol = fmtSolFromLamports(displayAuction?.highest_bid_lamports ?? null);
  const entryFeeSol = data?.pricing?.entryFeeSol ?? 1;

  const canShowBidBox = !!data?.ui?.hasEntered && displayAuction?.status === "live";
  const canShowAuctionButton = !!data?.ui?.hasEntered;
  const showStayMessage =
    !!displayAuction &&
    (displayAuction.status === "awaiting_payment" ||
      displayAuction.status === "completed" ||
      displayAuction.status === "rolled_over");

  const selectedCoinLabel =
    displayEntry?.coin_title?.trim() || displayEntry?.token_address || "Your selected coin";

  const nextMinBidSol = displayAuction?.next_min_bid_sol ?? null;
  const nextMinBidLamports = displayAuction?.next_min_bid_lamports ?? null;

  async function placeBid() {
    if (!targetDate) return;
    if (!canShowBidBox || bidBusy) return;

    const amount = Number(bidAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Enter a valid bid amount in SOL.");
      return;
    }

    setBidBusy(true);
    try {
      const res = await fetch("/api/dev/bidding-ad/bids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_date: targetDate,
          amount_sol: amount
        })
      });

      const json = (await res.json().catch(() => null)) as BidsResponse | any;

      if (!res.ok) {
        const minBidText =
          typeof json?.min_bid_sol === "number" ? ` Minimum bid is ${json.min_bid_sol} SOL.` : "";
        alert((json?.error ?? "Failed to place bid") + minBidText);
        return;
      }

      setBidsData(json as BidsResponse);
      setBidAmount("");

      await loadPage(targetDate);
    } finally {
      setBidBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-authswap text-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link href="/dev/profile" className="text-sm text-zinc-400 hover:text-white">
          ← Back to dev profile
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Bidding Ad Auction</h1>
            <p className="mt-1 text-sm text-zinc-400">Target day: {targetDate || "…"}</p>
          </div>

          {displayAuction ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
              {statusPillText(displayAuction.status)}
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="mt-6 text-zinc-400">Loading…</div>
        ) : err ? (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-200">
            {err}
          </div>
        ) : !data || !displayAuction ? null : (
          <>
            <div className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Auction status</h2>
                  {canShowAuctionButton ? (
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
                      You’re entered
                    </span>
                  ) : (
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-zinc-300">
                      View only
                    </span>
                  )}
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-xs text-zinc-400">Entry fee</div>
                    <div className="mt-2 text-xl font-semibold">{entryFeeSol} SOL</div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-xs text-zinc-400">Highest bid</div>
                    <div className="mt-2 text-xl font-semibold">{currentHighestSol}</div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-xs text-zinc-400">Bid count</div>
                    <div className="mt-2 text-xl font-semibold">{displayAuction.bid_count ?? 0}</div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="text-xs text-zinc-400">Highest bidder</div>
                    <div className="mt-2 text-sm font-semibold text-zinc-200">
                      {shortAddr(displayAuction.highest_bidder_wallet)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-sm font-semibold text-zinc-100">Countdown</div>

                  {displayAuction.status === "scheduled" ? (
                    <div className="mt-2">
                      <div className="text-xs text-zinc-400">Auction starts in</div>
                      <div className="mt-1 text-2xl font-semibold">{fmtCountdown(toStartMs)}</div>
                    </div>
                  ) : displayAuction.status === "live" ? (
                    <div className="mt-2">
                      <div className="text-xs text-zinc-400">Auction ends in</div>
                      <div className="mt-1 text-2xl font-semibold">{fmtCountdown(toEndMs)}</div>
                    </div>
                  ) : displayAuction.status === "awaiting_payment" ? (
                    <div className="mt-2 text-sm text-zinc-300">
                      Auction has ended and the current winner is in the payment window.
                    </div>
                  ) : displayAuction.status === "completed" ? (
                    <div className="mt-2 text-sm text-zinc-300">Auction completed successfully.</div>
                  ) : displayAuction.status === "rolled_over" ? (
                    <div className="mt-2 text-sm text-zinc-300">
                      Winner payment rolled over to another bidder or the flow continued after timeout.
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-zinc-300">Auction is not active.</div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="text-sm font-semibold text-zinc-100">Your entry</div>

                  {!displayEntry ? (
                    <div className="mt-2 text-sm text-zinc-500">
                      You have not entered this auction from your dev profile yet.
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 text-sm text-zinc-300">
                        Coin: <span className="font-semibold text-zinc-100">{selectedCoinLabel}</span>
                      </div>
                      {displayEntry.token_address ? (
                        <div className="mt-1 break-all font-mono text-xs text-zinc-500">
                          {displayEntry.token_address}
                        </div>
                      ) : null}
                      <div className="mt-2 text-xs text-zinc-500">
                        Entry payment: {displayEntry.entry_payment_status}
                      </div>
                    </>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-lg font-semibold">Schedule</h2>

                <div className="mt-4 space-y-2">
                  <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Entry opens</div>
                    <div className="mt-1 text-sm text-zinc-200">{fmtDate(data.schedule.entryOpensAt)}</div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Auction starts</div>
                    <div className="mt-1 text-sm text-zinc-200">{fmtDate(data.schedule.auctionStartsAt)}</div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500">Auction ends</div>
                    <div className="mt-1 text-sm text-zinc-200">{fmtDate(displayAuction.auction_ends_at)}</div>
                  </div>
                </div>

                {displayWinner ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3">
                    <div className="text-sm font-semibold text-zinc-100">Winner</div>
                    <div className="mt-2 text-sm text-zinc-300">
                      Winning bid:{" "}
                      <span className="font-semibold text-zinc-100">{fmtSolFromLamports(displayWinner.amount_lamports)}</span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Payment confirmed: {displayWinner.payment_confirmed_at ? "Yes" : "No"}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-lg font-semibold">Place bid</h2>

                {!data.ui.hasEntered ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-zinc-300">
                    You need to enter from your dev profile before you can bid.
                  </div>
                ) : displayAuction.status !== "live" ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-zinc-300">
                    Bidding is only available while the auction is live.
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
                    <div className="text-sm text-zinc-300">
                      Current highest bid is <span className="font-semibold text-zinc-100">{currentHighestSol}</span>.
                    </div>

                    <div className="mt-2 text-xs text-zinc-500">
                      Next minimum bid:{" "}
                      <span className="text-zinc-300">
                        {nextMinBidSol != null ? `${nextMinBidSol} SOL` : fmtSolFromLamports(nextMinBidLamports)}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3">
                      <input
                        value={bidAmount}
                        onChange={(e) => setBidAmount(e.target.value)}
                        inputMode="decimal"
                        placeholder={nextMinBidSol != null ? `Minimum ${nextMinBidSol} SOL` : "Bid amount in SOL"}
                        className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm"
                      />

                      <button
                        onClick={placeBid}
                        disabled={!canShowBidBox || bidBusy || !bidAmount.trim()}
                        className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                      >
                        {bidBusy ? "Placing bid…" : "Place bid"}
                      </button>
                    </div>

                    <p className="mt-3 text-xs text-zinc-500">
                      If a bid lands in the final 30 seconds, the timer extends.
                    </p>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 className="text-lg font-semibold">Bid activity</h2>

                <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
                  {bidsErr ? (
                    <div className="text-sm text-red-300">{bidsErr}</div>
                  ) : bidsLoading && !displayBids.length ? (
                    <div className="text-sm text-zinc-400">Loading bids…</div>
                  ) : displayBids.length === 0 ? (
                    <div className="text-sm text-zinc-500">No bids yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {displayBids.map((bid) => {
                        const mine = displayEntry?.id === bid.entry_id;
                        const highest = displayAuction.highest_bid_entry_id === bid.entry_id && displayAuction.highest_bid_lamports === bid.amount_lamports;

                        return (
                          <div
                            key={bid.id}
                            className="rounded-xl border border-white/10 bg-black/20 px-3 py-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-zinc-100">
                                    {fmtSolFromLamports(bid.amount_lamports)}
                                  </span>
                                  {highest ? (
                                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                                      HIGHEST
                                    </span>
                                  ) : null}
                                  {mine ? (
                                    <span className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-200">
                                      YOU
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-xs text-zinc-500">{shortAddr(bid.bidder_wallet)}</div>
                              </div>

                              <div className="shrink-0 text-[11px] text-zinc-500">{fmtDate(bid.placed_at)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {showStayMessage ? (
                  <div className="mt-4 rounded-xl border border-yellow-400/20 bg-yellow-400/10 p-4 text-sm text-yellow-100">
                    Stay on this page for another 5–10 minutes in case the current winner fails to pay and the slot rolls
                    down to the next bidder.
                  </div>
                ) : null}

                {data.ui.iWon ? (
                  <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                    You are currently the winning dev for this auction. When payment flow is added, this page will show your
                    payment button here.
                  </div>
                ) : null}
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
