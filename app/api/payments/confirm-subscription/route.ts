import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createSubToken, subCookie } from "@/lib/subscription";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const signature = body?.signature as string | undefined;

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    // Signed-in check
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const sessionData = await readSessionToken(sessionToken).catch(() => null);
    if (!sessionData?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) return NextResponse.json({ error: "Server missing SOLANA_RPC_URL" }, { status: 500 });

    const treasury = process.env.TREASURY_WALLET;
    if (!treasury) return NextResponse.json({ error: "Server missing TREASURY_WALLET" }, { status: 500 });

    const priceSol = Number(process.env.NEXT_PUBLIC_SUB_PRICE_SOL ?? "0");
    if (!Number.isFinite(priceSol) || priceSol <= 0) {
      return NextResponse.json({ error: "Server missing/invalid NEXT_PUBLIC_SUB_PRICE_SOL" }, { status: 500 });
    }

    // Fetch tx
    const connection = new Connection(rpcUrl, "confirmed");
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });

    if (!tx || !tx.meta) {
      return NextResponse.json({ error: "Transaction not confirmed yet. Try again." }, { status: 400 });
    }

    // Payer validation
    const staticKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const payer = staticKeys[0]?.toBase58();

    if (!payer || payer !== sessionData.wallet) {
      return NextResponse.json({ error: "Payer wallet mismatch" }, { status: 400 });
    }

    // Treasury received SOL
    const treasuryKey = new PublicKey(treasury);
    const treasuryIndex = staticKeys.findIndex((k) => k.equals(treasuryKey));
    if (treasuryIndex === -1) {
      return NextResponse.json({ error: "Treasury not involved in transaction" }, { status: 400 });
    }

    const preLamports = tx.meta.preBalances[treasuryIndex] ?? 0;
    const postLamports = tx.meta.postBalances[treasuryIndex] ?? 0;
    const deltaLamports = postLamports - preLamports;
    const deltaSol = deltaLamports / 1_000_000_000;

    if (deltaSol + 1e-9 < priceSol) {
      return NextResponse.json({ error: `Payment too low. Received ~${deltaSol.toFixed(4)} SOL` }, { status: 400 });
    }

    // Write to Supabase (dedupe by signature)
    const sb = supabaseAdmin();

    // ensure user exists
    const { error: userErr } = await sb.from("users").upsert({ wallet: sessionData.wallet });
    if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });

    // insert payment (if already exists, don’t double credit)
    const { data: existingPayment } = await sb.from("payments").select("signature").eq("signature", signature).maybeSingle();
    if (existingPayment?.signature) {
      // payment already recorded, just refresh subscription token from DB
    } else {
      const { error: payErr } = await sb.from("payments").insert({
        signature,
        wallet: sessionData.wallet,
        kind: "subscription",
        amount_sol: deltaSol
      });
      if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });
    }

    // Extend subscription: max(current_paid_until, now) + 30 days
    const { data: subRow } = await sb
      .from("subscriptions")
      .select("paid_until")
      .eq("wallet", sessionData.wallet)
      .maybeSingle();

    const now = new Date();
    const currentPaidUntil = subRow?.paid_until ? new Date(subRow.paid_until) : null;
    const base = currentPaidUntil && currentPaidUntil > now ? currentPaidUntil : now;

    const paidUntil = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { error: subErr } = await sb.from("subscriptions").upsert({
      wallet: sessionData.wallet,
      paid_until: paidUntil.toISOString(),
      cancel_at_period_end: false,
      updated_at: new Date().toISOString()
    });
    if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });

    // Mint cookie token from DB value (still used by middleware)
    const subToken = await createSubToken({ wallet: sessionData.wallet, paidUntilMs: paidUntil.getTime() });
    const res = NextResponse.json({ ok: true, paidUntilMs: paidUntil.getTime() });
    res.headers.set("Set-Cookie", subCookie(subToken));
    return res;
  } catch (err: any) {
    console.error("confirm-subscription error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
