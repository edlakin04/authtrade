import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  return toDateOnlyUtc(addUtcDays(startOfUtcDay(now), 1));
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

function getEntryFeeLamports() {
  const sol = Number(process.env.BIDDING_AD_ENTRY_FEE_SOL ?? "1");

  if (!Number.isFinite(sol) || sol <= 0) {
    throw new Error("Invalid BIDDING_AD_ENTRY_FEE_SOL env value");
  }

  return Math.round(sol * 1_000_000_000);
}

async function getViewerWallet() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return null;

  const session = await readSessionToken(sessionToken).catch(() => null);
  return session?.wallet ?? null;
}

async function getEntryForWalletAndDate(wallet: string, targetDate: string) {
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

async function getEntryBySignature(signature: string) {
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
    kind: "bidding_ad_entry",
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

    const entry = await getEntryForWalletAndDate(wallet, targetDate);
    if (!entry) {
      return NextResponse.json({ error: "Bidding entry not found for this wallet and target date" }, { status: 404 });
    }

    if (entry.entry_payment_status === "paid") {
      return NextResponse.json({
        ok: true,
        entry_id: entry.id,
        target_date: targetDate,
        already_paid: true
      });
    }

    const reused = await getEntryBySignature(signature);
    if (reused && String(reused.id) !== String(entry.id)) {
      return NextResponse.json({ error: "Signature already used" }, { status: 400 });
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
          error: `Entry fee too low. Expected ${requiredLamports} lamports, received ${deltaLamports} lamports`
        },
        { status: 400 }
      );
    }

    const confirmedAt = new Date().toISOString();
    const sb = supabaseAdmin();

    const { error: updateErr } = await sb
      .from("bidding_ad_entries")
      .update({
        entry_payment_status: "paid",
        entry_payment_signature: signature,
        entry_payment_confirmed_at: confirmedAt
      })
      .eq("id", entry.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    await recordPayment({
      signature,
      wallet,
      amountSol: deltaLamports / 1_000_000_000,
      targetDate
    });

    return NextResponse.json({
      ok: true,
      entry_id: entry.id,
      target_date: targetDate,
      payment: {
        confirmed: true,
        confirmed_at: confirmedAt,
        signature
      }
    });
  } catch (e: any) {
    console.error("confirm-bidding-entry error:", e);
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
