import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RoleRow = { role: string | null };

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDateOnlyUtc(d: Date) {
  return d.toISOString().slice(0, 10);
}

function currentTargetDate(now = new Date()) {
  const todayUtc = startOfUtcDay(now);
  return toDateOnlyUtc(addUtcDays(todayUtc, 1));
}

function adWindowForTargetDate(targetDate: string) {
  const day = new Date(`${targetDate}T00:00:00.000Z`);

  const adStartsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 13, 0, 0, 0)
  );
  const adEndsAt = new Date(adStartsAt.getTime() + 23 * 60 * 60 * 1000);

  return {
    adStartsAt,
    adEndsAt
  };
}

function getTreasuryWallet() {
  const wallet =
    process.env.TREASURY_WALLET ||
    process.env.NEXT_PUBLIC_TREASURY_WALLET ||
    "";

  if (!wallet.trim()) {
    throw new Error("Server missing TREASURY_WALLET / NEXT_PUBLIC_TREASURY_WALLET");
  }

  return wallet.trim();
}

async function getViewerWallet() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

async function requireDev(wallet: string) {
  const sb = supabaseAdmin();

  const prof = await sb.from("dev_profiles").select("wallet").eq("wallet", wallet).maybeSingle();
  if (!prof.error && prof.data?.wallet) return true;

  const { data: user } = await sb
    .from("users")
    .select("role")
    .eq("wallet", wallet)
    .maybeSingle<RoleRow>();

  const role = (user?.role ?? null) as string | null;
  return role === "dev" || role === "admin";
}

async function getAuction(targetDate: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_auctions")
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getCurrentAwaitingPaymentRow(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_payment_queue")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, bidder_wallet, amount_lamports, priority_rank, status, payment_due_at, paid_at, skipped_at, created_at, updated_at"
    )
    .eq("auction_id", auctionId)
    .eq("status", "awaiting_payment")
    .order("priority_rank", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getQueueRowById(rowId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_payment_queue")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, bidder_wallet, amount_lamports, priority_rank, status, payment_due_at, paid_at, skipped_at, created_at, updated_at"
    )
    .eq("id", rowId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getWinnerByAuctionId(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .eq("auction_id", auctionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getWinnerByPaymentSignature(signature: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .eq("payment_signature", signature)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getEntry(entryId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_entries")
    .select(
      "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, entry_payment_signature, entry_payment_confirmed_at, created_at, updated_at"
    )
    .eq("id", entryId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function markQueueRowPaid(rowId: string, paidAtIso: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_payment_queue")
    .update({
      status: "paid",
      paid_at: paidAtIso
    })
    .eq("id", rowId)
    .select(
      "id, auction_id, target_date, entry_id, bid_id, bidder_wallet, amount_lamports, priority_rank, status, payment_due_at, paid_at, skipped_at, created_at, updated_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function markAuctionCompleted(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_auctions")
    .update({ status: "completed" })
    .eq("id", auctionId)
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function createWinner(params: {
  auctionId: string;
  targetDate: string;
  entryId: string;
  bidId: string;
  amountLamports: number;
  paidAtIso: string;
  signature: string;
}) {
  const existing = await getWinnerByAuctionId(params.auctionId);
  if (existing) return existing;

  const entry = await getEntry(params.entryId);
  if (!entry) throw new Error("Winning entry not found");

  const { adStartsAt, adEndsAt } = adWindowForTargetDate(params.targetDate);
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_winners")
    .insert({
      auction_id: params.auctionId,
      target_date: params.targetDate,
      entry_id: params.entryId,
      bid_id: params.bidId,
      dev_wallet: entry.dev_wallet,
      coin_id: entry.coin_id,
      banner_path: entry.banner_path,
      amount_lamports: params.amountLamports,
      ad_starts_at: adStartsAt.toISOString(),
      ad_ends_at: adEndsAt.toISOString(),
      payment_confirmed_at: params.paidAtIso,
      payment_signature: params.signature
    })
    .select(
      "id, auction_id, target_date, entry_id, bid_id, dev_wallet, coin_id, banner_path, amount_lamports, ad_starts_at, ad_ends_at, payment_confirmed_at, payment_signature, created_at"
    )
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function getQueue(auctionId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_payment_queue")
    .select(
      "id, auction_id, target_date, entry_id, bid_id, bidder_wallet, amount_lamports, priority_rank, status, payment_due_at, paid_at, skipped_at, created_at, updated_at"
    )
    .eq("auction_id", auctionId)
    .order("priority_rank", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function recordPayment(params: {
  signature: string;
  wallet: string;
  amountSol: number;
  targetDate: string;
}) {
  const sb = supabaseAdmin();

  const { data: existing, error: existingErr } = await sb
    .from("payments")
    .select("signature")
    .eq("signature", params.signature)
    .maybeSingle();

  if (existingErr) throw new Error(existingErr.message);
  if (existing?.signature) return;

  const { error } = await sb.from("payments").insert({
    signature: params.signature,
    wallet: params.wallet,
    kind: "bidding_ad_winner",
    amount_sol: params.amountSol,
    meta: { target_date: params.targetDate }
  });

  if (error) throw new Error(error.message);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const signature = (body?.signature as string | undefined)?.trim();
    const targetDate = ((body?.target_date as string | undefined)?.trim() || currentTargetDate());

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    const wallet = await getViewerWallet();
    if (!wallet) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    if (!(await requireDev(wallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: "Server missing SOLANA_RPC_URL" }, { status: 500 });
    }

    const treasuryWallet = getTreasuryWallet();

    const winnerBySig = await getWinnerByPaymentSignature(signature);
    if (winnerBySig) {
      const auctionForWinner = await getAuction(String(winnerBySig.target_date));
      return NextResponse.json({
        ok: true,
        auction: auctionForWinner,
        winner: winnerBySig,
        queue: auctionForWinner ? await getQueue(String(winnerBySig.auction_id)) : [],
        message: "Winner payment already confirmed with this signature"
      });
    }

    const auction = await getAuction(targetDate);
    if (!auction) {
      return NextResponse.json({ error: "Auction not found for target date" }, { status: 404 });
    }

    if (auction.status !== "awaiting_payment" && auction.status !== "completed") {
      return NextResponse.json(
        { error: "Auction is not awaiting winner payment" },
        { status: 400 }
      );
    }

    const existingWinner = await getWinnerByAuctionId(String(auction.id));
    if (existingWinner?.payment_confirmed_at) {
      return NextResponse.json({
        ok: true,
        auction,
        winner: existingWinner,
        queue: await getQueue(String(auction.id)),
        message: "Winner already paid"
      });
    }

    const currentRow = await getCurrentAwaitingPaymentRow(String(auction.id));
    if (!currentRow) {
      return NextResponse.json(
        { error: "There is no active payment window right now" },
        { status: 400 }
      );
    }

    if (String(currentRow.bidder_wallet) !== wallet) {
      return NextResponse.json({ error: "It is not your turn to pay" }, { status: 403 });
    }

    const dueAtMs = currentRow.payment_due_at ? Date.parse(String(currentRow.payment_due_at)) : NaN;
    if (!Number.isFinite(dueAtMs)) {
      return NextResponse.json({ error: "Payment due time is missing" }, { status: 400 });
    }

    if (Date.now() > dueAtMs) {
      return NextResponse.json({ error: "Your payment window has expired" }, { status: 400 });
    }

    const connection = new Connection(rpcUrl, "confirmed");
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });

    if (!tx || !tx.meta) {
      return NextResponse.json(
        { error: "Transaction not confirmed yet. Try again." },
        { status: 400 }
      );
    }

    const staticKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const payer = staticKeys[0]?.toBase58();

    if (!payer || payer !== wallet) {
      return NextResponse.json({ error: "Payer wallet mismatch" }, { status: 400 });
    }

    const treasuryKey = new PublicKey(treasuryWallet);
    const treasuryIndex = staticKeys.findIndex((k) => k.equals(treasuryKey));

    if (treasuryIndex === -1) {
      return NextResponse.json(
        { error: "Treasury wallet not involved in transaction" },
        { status: 400 }
      );
    }

    const preLamports = tx.meta.preBalances[treasuryIndex] ?? 0;
    const postLamports = tx.meta.postBalances[treasuryIndex] ?? 0;
    const deltaLamports = postLamports - preLamports;
    const expectedLamports = Number(currentRow.amount_lamports) || 0;

    if (!Number.isFinite(expectedLamports) || expectedLamports <= 0) {
      return NextResponse.json({ error: "Winning amount is invalid" }, { status: 400 });
    }

    if (deltaLamports < expectedLamports) {
      return NextResponse.json(
        {
          error: `Winning payment too low. Expected ${expectedLamports} lamports, received ${deltaLamports} lamports`
        },
        { status: 400 }
      );
    }

    const rowNow = await getQueueRowById(String(currentRow.id));
    if (!rowNow) {
      return NextResponse.json({ error: "Payment queue row no longer exists" }, { status: 400 });
    }

    if (rowNow.status === "paid") {
      const winner = await getWinnerByAuctionId(String(auction.id));
      return NextResponse.json({
        ok: true,
        auction,
        winner,
        queue: await getQueue(String(auction.id)),
        message: "Winning payment already confirmed"
      });
    }

    if (rowNow.status !== "awaiting_payment") {
      return NextResponse.json({ error: "Payment window is no longer active" }, { status: 400 });
    }

    const paidAtIso = new Date().toISOString();
    const paidRow = await markQueueRowPaid(String(rowNow.id), paidAtIso);

    await recordPayment({
      signature,
      wallet,
      amountSol: deltaLamports / 1_000_000_000,
      targetDate
    });

    const winner = await createWinner({
      auctionId: String(auction.id),
      targetDate,
      entryId: String(paidRow.entry_id),
      bidId: String(paidRow.bid_id),
      amountLamports: Number(paidRow.amount_lamports) || 0,
      paidAtIso,
      signature
    });

    const updatedAuction = await markAuctionCompleted(String(auction.id));
    const queue = await getQueue(String(auction.id));

    return NextResponse.json({
      ok: true,
      auction: updatedAuction,
      winner,
      queue,
      payment: {
        paid: true,
        paid_at: paidAtIso,
        signature
      }
    });
  } catch (e: any) {
    console.error("confirm-bidding-winner error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
