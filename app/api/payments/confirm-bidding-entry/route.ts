// app/api/payments/confirm-bidding-entry/route.ts
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

function biddingAdScheduleForTargetDate(targetDate: string) {
  const day = new Date(`${targetDate}T00:00:00.000Z`);
  const prevDay = addUtcDays(day, -1);

  const entryOpensAt = new Date(
    Date.UTC(prevDay.getUTCFullYear(), prevDay.getUTCMonth(), prevDay.getUTCDate(), 23, 0, 0, 0)
  );
  const auctionStartsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0, 0, 0)
  );
  const auctionEndsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12, 0, 0, 0)
  );

  return {
    entryOpensAt,
    auctionStartsAt,
    auctionEndsAt
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

function getEntryFeeSol() {
  const sol = Number(process.env.BIDDING_AD_ENTRY_FEE_SOL ?? "1");

  if (!Number.isFinite(sol) || sol <= 0) {
    throw new Error("Invalid BIDDING_AD_ENTRY_FEE_SOL env value");
  }

  return sol;
}

function getEntryFeeLamports() {
  return Math.round(getEntryFeeSol() * 1_000_000_000);
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

  const { data: user } = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle<RoleRow>();
  const role = (user?.role ?? null) as string | null;

  return role === "dev" || role === "admin";
}

async function getOrCreateAuction(targetDate: string) {
  const sb = supabaseAdmin();

  const existingRes = await sb
    .from("bidding_ad_auctions")
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (existingRes.error) throw new Error(existingRes.error.message);
  if (existingRes.data) return existingRes.data;

  const schedule = biddingAdScheduleForTargetDate(targetDate);

  const insertRes = await sb
    .from("bidding_ad_auctions")
    .insert({
      target_date: targetDate,
      entry_opens_at: schedule.entryOpensAt.toISOString(),
      auction_starts_at: schedule.auctionStartsAt.toISOString(),
      auction_ends_at: schedule.auctionEndsAt.toISOString(),
      status: "scheduled"
    })
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .single();

  if (!insertRes.error && insertRes.data) return insertRes.data;

  const retryRes = await sb
    .from("bidding_ad_auctions")
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (retryRes.error) throw new Error(retryRes.error.message);
  if (!retryRes.data) {
    throw new Error(insertRes.error?.message || "Failed to create bidding ad auction");
  }

  return retryRes.data;
}

async function getOwnedCoinForWallet(wallet: string, coinId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("coins")
    .select("id, wallet, token_address, title, description, created_at")
    .eq("id", coinId)
    .eq("wallet", wallet)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function findExistingEntryByWalletAndDate(wallet: string, targetDate: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_entries")
    .select(
      "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, entry_payment_signature, entry_payment_confirmed_at, created_at, updated_at"
    )
    .eq("dev_wallet", wallet)
    .eq("target_date", targetDate)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function findExistingEntryBySignature(signature: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_entries")
    .select(
      "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, entry_payment_signature, entry_payment_confirmed_at, created_at, updated_at"
    )
    .eq("entry_payment_signature", signature)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";

let signature = "";
let targetDate = currentTargetDate();
let coinId = "";
let file: File | null = null;

if (contentType.includes("multipart/form-data")) {
  const form = await req.formData();
  signature = String(form.get("signature") || "").trim();
  targetDate = String(form.get("target_date") || currentTargetDate()).trim();
  coinId = String(form.get("coin_id") || "").trim();

  const maybeFile = form.get("file");
  file = maybeFile instanceof File ? maybeFile : null;
} else {
  const body = await req.json().catch(() => null);
  signature = String(body?.signature || "").trim();
  targetDate = String(body?.target_date || currentTargetDate()).trim();
  coinId = String(body?.coin_id || "").trim();
}
    const coinId = (body?.coin_id as string | undefined)?.trim();
    const bannerPath = (body?.banner_path as string | undefined)?.trim();

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return NextResponse.json({ error: "Invalid target_date" }, { status: 400 });
    }

    if (!coinId) {
      return NextResponse.json({ error: "Missing coin_id" }, { status: 400 });
    }

    if (!bannerPath) {
      return NextResponse.json({ error: "Missing banner_path" }, { status: 400 });
    }

    const wallet = await getViewerWallet();
    if (!wallet) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    if (!(await requireDev(wallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const auction = await getOrCreateAuction(targetDate);

    const now = new Date();
    const entryOpensAt = new Date(String(auction.entry_opens_at));
    const auctionStartsAt = new Date(String(auction.auction_starts_at));

    if (now < entryOpensAt) {
      return NextResponse.json({ error: "Bidding Ad entry is not open yet" }, { status: 400 });
    }

    if (now >= auctionStartsAt) {
      return NextResponse.json({ error: "Bidding Ad entry is closed for that day" }, { status: 400 });
    }

    const ownedCoin = await getOwnedCoinForWallet(wallet, coinId);
    if (!ownedCoin) {
      return NextResponse.json({ error: "Selected coin not found for this dev wallet" }, { status: 400 });
    }

    const existingBySig = await findExistingEntryBySignature(signature);
    if (existingBySig) {
      if (existingBySig.dev_wallet === wallet && existingBySig.target_date === targetDate) {
        return NextResponse.json({
          ok: true,
          already_paid: true,
          entry: existingBySig,
          target_date: targetDate
        });
      }

      return NextResponse.json({ error: "Signature already used" }, { status: 400 });
    }

    const existingByWalletAndDate = await findExistingEntryByWalletAndDate(wallet, targetDate);
    if (existingByWalletAndDate?.entry_payment_status === "paid") {
      return NextResponse.json({
        ok: true,
        already_paid: true,
        entry: existingByWalletAndDate,
        target_date: targetDate
      });
    }

    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: "Server missing SOLANA_RPC_URL" }, { status: 500 });
    }

    const treasuryWallet = getTreasuryWallet();
    const requiredLamports = getEntryFeeLamports();

    const connection = new Connection(rpcUrl, "confirmed");
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });

    if (!tx || !tx.meta) {
      return NextResponse.json({ error: "Transaction not confirmed yet. Try again." }, { status: 400 });
    }

    const staticKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const payer = staticKeys[0]?.toBase58();

    if (!payer || payer !== wallet) {
      return NextResponse.json({ error: "Payer wallet mismatch" }, { status: 400 });
    }

    const treasuryKey = new PublicKey(treasuryWallet);
    const treasuryIndex = staticKeys.findIndex((k) => k.equals(treasuryKey));

    if (treasuryIndex === -1) {
      return NextResponse.json({ error: "Treasury wallet not involved in transaction" }, { status: 400 });
    }

    const preLamports = tx.meta.preBalances[treasuryIndex] ?? 0;
    const postLamports = tx.meta.postBalances[treasuryIndex] ?? 0;
    const deltaLamports = postLamports - preLamports;

    if (deltaLamports < requiredLamports) {
      return NextResponse.json(
        {
          error: `Entry fee too low. Received ${deltaLamports} lamports, expected at least ${requiredLamports}.`
        },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();
    const paidAtIso = new Date().toISOString();

    if (existingByWalletAndDate) {
      const { data: updated, error: updateErr } = await sb
        .from("bidding_ad_entries")
        .update({
          auction_id: auction.id,
          coin_id: ownedCoin.id,
          banner_path: bannerPath,
          coin_title: ownedCoin.title ?? null,
          token_address: ownedCoin.token_address ?? null,
          entry_fee_lamports: requiredLamports,
          entry_payment_status: "paid",
          entry_payment_signature: signature,
          entry_payment_confirmed_at: paidAtIso
        })
        .eq("id", existingByWalletAndDate.id)
        .eq("dev_wallet", wallet)
        .eq("target_date", targetDate)
        .select(
          "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, entry_payment_signature, entry_payment_confirmed_at, created_at, updated_at"
        )
        .single();

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        target_date: targetDate,
        entry: updated,
        payment: {
          signature,
          confirmed_at: paidAtIso,
          amount_lamports: requiredLamports,
          amount_sol: requiredLamports / 1_000_000_000
        }
      });
    }

    const { data: inserted, error: insertErr } = await sb
      .from("bidding_ad_entries")
      .insert({
        auction_id: auction.id,
        target_date: targetDate,
        dev_wallet: wallet,
        coin_id: ownedCoin.id,
        banner_path: bannerPath,
        coin_title: ownedCoin.title ?? null,
        token_address: ownedCoin.token_address ?? null,
        entry_fee_lamports: requiredLamports,
        entry_payment_status: "paid",
        entry_payment_signature: signature,
        entry_payment_confirmed_at: paidAtIso
      })
      .select(
        "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, entry_payment_signature, entry_payment_confirmed_at, created_at, updated_at"
      )
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      target_date: targetDate,
      entry: inserted,
      payment: {
        signature,
        confirmed_at: paidAtIso,
        amount_lamports: requiredLamports,
        amount_sol: requiredLamports / 1_000_000_000
      }
    });
  } catch (e: any) {
    console.error("confirm-bidding-entry error:", e);

    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
