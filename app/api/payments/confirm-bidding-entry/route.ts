// app/api/payments/confirm-bidding-entry/route.ts
import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RoleRow = { role: string | null };

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

async function getEntryByWalletAndTargetDate(wallet: string, targetDate: string) {
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

    const entry = await getEntryByWalletAndTargetDate(wallet, targetDate);
    if (!entry) {
      return NextResponse.json(
        { error: "Bidding ad entry not found for this wallet and target date" },
        { status: 404 }
      );
    }

    if (entry.entry_payment_status === "paid") {
      return NextResponse.json({
        ok: true,
        entry_id: String(entry.id),
        target_date: targetDate,
        already_paid: true
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

    if (deltaLamports < requiredLamports) {
      return NextResponse.json(
        {
          error: `Entry fee too low. Received ${deltaLamports} lamports, expected at least ${requiredLamports}.`
        },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    const { data: existingSig, error: existingSigErr } = await sb
      .from("bidding_ad_entries")
      .select("id, target_date, entry_payment_signature")
      .eq("entry_payment_signature", signature)
      .maybeSingle();

    if (existingSigErr) {
      return NextResponse.json({ error: existingSigErr.message }, { status: 500 });
    }

    if (existingSig?.entry_payment_signature) {
      if (String(existingSig.id) === String(entry.id)) {
        return NextResponse.json({
          ok: true,
          entry_id: String(entry.id),
          target_date: targetDate,
          already_paid: true
        });
      }

      return NextResponse.json({ error: "Signature already used" }, { status: 400 });
    }

    const paidAtIso = new Date().toISOString();

    const { error: updateErr } = await sb
      .from("bidding_ad_entries")
      .update({
        entry_payment_status: "paid",
        entry_payment_signature: signature,
        entry_payment_confirmed_at: paidAtIso
      })
      .eq("id", entry.id)
      .eq("dev_wallet", wallet)
      .eq("target_date", targetDate);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      entry_id: String(entry.id),
      target_date: targetDate,
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
