import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getTreasuryWallet() {
  const wallet =
    process.env.TREASURY_WALLET ||
    process.env.NEXT_PUBLIC_TREASURY_WALLET ||
    "";

  if (!wallet.trim()) {
    throw new Error("Server missing TREASURY_WALLET");
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const signature = body?.signature as string | undefined;
    const entryId = body?.entry_id as string | undefined;

    if (!signature || !entryId) {
      return NextResponse.json(
        { error: "Missing signature or entry_id" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const session = await readSessionToken(sessionToken).catch(() => null);

    if (!session?.wallet) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const wallet = session.wallet;

    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json(
        { error: "Server missing SOLANA_RPC_URL" },
        { status: 500 }
      );
    }

    const treasuryWallet = getTreasuryWallet();
    const entryFeeSol = getEntryFeeSol();

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
      return NextResponse.json(
        { error: "Payer wallet mismatch" },
        { status: 400 }
      );
    }

    const treasuryKey = new PublicKey(treasuryWallet);

    const treasuryIndex = staticKeys.findIndex((k) =>
      k.equals(treasuryKey)
    );

    if (treasuryIndex === -1) {
      return NextResponse.json(
        { error: "Treasury wallet not involved in transaction" },
        { status: 400 }
      );
    }

    const preLamports = tx.meta.preBalances[treasuryIndex] ?? 0;
    const postLamports = tx.meta.postBalances[treasuryIndex] ?? 0;

    const deltaLamports = postLamports - preLamports;
    const deltaSol = deltaLamports / 1_000_000_000;

    if (deltaSol + 1e-9 < entryFeeSol) {
      return NextResponse.json(
        { error: `Entry fee too low. Received ~${deltaSol.toFixed(4)} SOL` },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    // prevent signature reuse
    const { data: existing } = await sb
      .from("bidding_ad_entries")
      .select("entry_payment_signature")
      .eq("entry_payment_signature", signature)
      .maybeSingle();

    if (existing?.entry_payment_signature) {
      return NextResponse.json(
        { error: "Signature already used" },
        { status: 400 }
      );
    }

    // confirm entry belongs to wallet
    const { data: entry } = await sb
      .from("bidding_ad_entries")
      .select("id, dev_wallet, entry_payment_status")
      .eq("id", entryId)
      .maybeSingle();

    if (!entry || entry.dev_wallet !== wallet) {
      return NextResponse.json(
        { error: "Entry not found for this wallet" },
        { status: 404 }
      );
    }

    if (entry.entry_payment_status === "paid") {
      return NextResponse.json({ ok: true });
    }

    const { error: updateErr } = await sb
      .from("bidding_ad_entries")
      .update({
        entry_payment_status: "paid",
        entry_payment_signature: signature,
        entry_payment_confirmed_at: new Date().toISOString()
      })
      .eq("id", entryId);

    if (updateErr) {
      return NextResponse.json(
        { error: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      entry_id: entryId
    });

  } catch (e: any) {
    console.error("confirm-bidding-entry error:", e);

    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
