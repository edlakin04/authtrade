import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createSubToken, subCookie } from "@/lib/subscription";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const signature = body?.signature as string | undefined;

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const treasury = process.env.TREASURY_WALLET;
  if (!treasury) {
    return NextResponse.json({ error: "Server missing TREASURY_WALLET" }, { status: 500 });
  }

  const priceSol = Number(process.env.NEXT_PUBLIC_SUB_PRICE_SOL ?? "0");
  if (!Number.isFinite(priceSol) || priceSol <= 0) {
    return NextResponse.json({ error: "Server missing/invalid NEXT_PUBLIC_SUB_PRICE_SOL" }, { status: 500 });
  }

  // Ensure user is signed-in
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const sessionData = await readSessionToken(sessionToken).catch(() => null);
  if (!sessionData?.wallet) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  // Verify tx on Solana (confirmed)
  const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  });

  if (!tx || !tx.meta) {
    return NextResponse.json({ error: "Transaction not confirmed yet. Try again." }, { status: 400 });
  }

  // Fee payer (usually first static key)
  const staticKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const payer = staticKeys[0]?.toBase58();
  if (!payer || payer !== sessionData.wallet) {
    return NextResponse.json({ error: "Payer wallet mismatch" }, { status: 400 });
  }

  // Ensure treasury received SOL in this tx
  const treasuryKey = new PublicKey(treasury);
  const treasuryIndex = staticKeys.findIndex((k) => k.equals(treasuryKey));
  if (treasuryIndex === -1) {
    return NextResponse.json({ error: "Treasury not involved in tx" }, { status: 400 });
  }

  const preLamports = tx.meta.preBalances[treasuryIndex] ?? 0;
  const postLamports = tx.meta.postBalances[treasuryIndex] ?? 0;
  const deltaLamports = postLamports - preLamports;
  const deltaSol = deltaLamports / 1_000_000_000;

  if (deltaSol + 1e-9 < priceSol) {
    return NextResponse.json(
      { error: `Payment too low. Received ~${deltaSol.toFixed(4)} SOL` },
      { status: 400 }
    );
  }

  // Credit subscription: 30 days from now (temporary cookie-based system)
  const now = Date.now();
  const paidUntilMs = now + 30 * 24 * 60 * 60 * 1000;

  const subToken = await createSubToken({ wallet: sessionData.wallet, paidUntilMs });
  const res = NextResponse.json({ ok: true, paidUntilMs });

  res.headers.set("Set-Cookie", subCookie(subToken));
  return res;
}
