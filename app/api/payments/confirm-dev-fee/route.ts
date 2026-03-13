import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  isBlockedCountry,
  getApplicableVatRate,
  getJurisdiction,
  extractVat,
} from "@/lib/vatRules";
import { getSolGbpPrice } from "@/lib/solPrice";

const REF_COOKIE_NAME = "authswap_ref";
const DEV_AFFILIATE_CUT_SOL = 1.0;  // affiliate earns 1 SOL per dev subscription payment

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const signature       = (body?.signature        as string | undefined)?.trim();
    const declaredCountry = (body?.declared_country  as string | undefined)?.trim()?.toUpperCase() ?? null;
    const ipCountry       = (body?.ip_country        as string | undefined)?.trim()?.toUpperCase() ?? null;

    if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

    // ── Block Russia and Belarus server-side ──────────────────────────────
    const countryToCheck = declaredCountry ?? ipCountry;
    if (countryToCheck && isBlockedCountry(countryToCheck)) {
      return NextResponse.json({ error: "Service not available in your region" }, { status: 403 });
    }

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const refCookieValue = cookieStore.get(REF_COOKIE_NAME)?.value ?? null;
    if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const sessionData = await readSessionToken(sessionToken).catch(() => null);
    if (!sessionData?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) return NextResponse.json({ error: "Server missing SOLANA_RPC_URL" }, { status: 500 });

    const devTreasury = process.env.TREASURY_WALLET;
    if (!devTreasury) return NextResponse.json({ error: "Server missing TREASURY_WALLET" }, { status: 500 });

    const feeSol = Number(process.env.DEV_FEE_SOL ?? "0");
    if (!Number.isFinite(feeSol) || feeSol <= 0) {
      return NextResponse.json({ error: "Server missing/invalid DEV_FEE_SOL" }, { status: 500 });
    }

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
    if (!payer || payer !== sessionData.wallet) {
      return NextResponse.json({ error: "Payer wallet mismatch" }, { status: 400 });
    }

    const treasuryKey = new PublicKey(devTreasury);
    const treasuryIndex = staticKeys.findIndex((k) => k.equals(treasuryKey));
    if (treasuryIndex === -1) {
      return NextResponse.json({ error: "Dev treasury not involved in transaction" }, { status: 400 });
    }

    const preLamports = tx.meta.preBalances[treasuryIndex] ?? 0;
    const postLamports = tx.meta.postBalances[treasuryIndex] ?? 0;
    const deltaLamports = postLamports - preLamports;
    const deltaSol = deltaLamports / 1_000_000_000;

    if (deltaSol + 1e-9 < feeSol) {
      return NextResponse.json(
        { error: `Dev fee too low. Received ~${deltaSol.toFixed(4)} SOL` },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    await sb.from("users").upsert({ wallet: sessionData.wallet });

    // ── Resolve affiliate referrer ────────────────────────────────────────
    let validReferrer: string | null = null;

    if (refCookieValue && refCookieValue !== sessionData.wallet) {
      const { data: devCheck } = await sb
        .from("dev_profiles")
        .select("wallet")
        .eq("wallet", refCookieValue)
        .maybeSingle();

      if (devCheck?.wallet) {
        validReferrer = refCookieValue;
      } else {
        const { data: userCheck } = await sb
          .from("users")
          .select("role")
          .eq("wallet", refCookieValue)
          .maybeSingle();
        if (userCheck?.role === "dev" || userCheck?.role === "admin") {
          validReferrer = refCookieValue;
        }
      }
    }

    // ── Compute VAT fields ────────────────────────────────────────────────
    let vatRate         = 0;
    let vatAmountSol    = 0;
    let vatAmountGbp:  number | null = null;
    let solGbpRate:    number | null = null;
    let vatJurisdiction: string | null = null;
    const countryMismatch = !!(declaredCountry && ipCountry && declaredCountry !== ipCountry);

    if (declaredCountry) {
      try {
        const { data: cumulative } = await sb
          .from("vat_cumulative")
          .select("jurisdiction, threshold_crossed");

        const thresholdCrossed: Record<string, boolean> = {};
        for (const row of cumulative ?? []) {
          thresholdCrossed[row.jurisdiction] = row.threshold_crossed ?? false;
        }

        vatRate        = getApplicableVatRate(declaredCountry, thresholdCrossed);
        vatJurisdiction = getJurisdiction(declaredCountry);

        if (vatRate > 0) {
          const { vat } = extractVat(deltaSol, vatRate);
          vatAmountSol   = vat;
          solGbpRate     = await getSolGbpPrice();
          if (solGbpRate) {
            vatAmountGbp = Math.round(vatAmountSol * solGbpRate * 100) / 100;
          }
        }
      } catch (vatErr: any) {
        console.warn("VAT computation failed:", vatErr?.message);
      }
    }

    // ── Dedupe payment ────────────────────────────────────────────────────
    const { data: existing } = await sb.from("payments").select("signature").eq("signature", signature).maybeSingle();
    if (!existing?.signature) {
      const { error: payErr } = await sb.from("payments").insert({
        signature,
        wallet:                  sessionData.wallet,
        kind:                    "dev_fee",
        amount_sol:              deltaSol,
        referrer_wallet:         validReferrer,
        // VAT fields
        ip_country:              ipCountry,
        declared_country:        declaredCountry,
        country_mismatch:        countryMismatch,
        vat_rate:                vatRate > 0 ? vatRate : null,
        vat_amount_sol:          vatAmountSol > 0 ? vatAmountSol : null,
        vat_amount_gbp:          vatAmountGbp,
        sol_gbp_rate_at_payment: solGbpRate,
        vat_jurisdiction:        vatJurisdiction,
      });
      if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

      // ── Update VAT cumulative totals ──────────────────────────────────
      if (declaredCountry && vatJurisdiction && vatJurisdiction !== "NONE" && vatJurisdiction !== "BLOCKED") {
        const gbpForPayment = solGbpRate ? Math.round(deltaSol * solGbpRate * 100) / 100 : 0;
        await Promise.resolve(sb.rpc("increment_vat_cumulative", {
          p_jurisdiction:   vatJurisdiction,
          p_revenue_gbp:    gbpForPayment,
          p_revenue_native: gbpForPayment,
          p_payment_count:  1,
        })).catch(() => null);
      }

      // ── Record affiliate earning ───────────────────────────────────────
      if (validReferrer) {
        await Promise.resolve(sb.from("affiliate_earnings").insert({
          referrer_wallet:   validReferrer,
          referee_wallet:    sessionData.wallet,
          payment_signature: signature,
          amount_sol:        DEV_AFFILIATE_CUT_SOL,
          kind:              "dev_sub",
          paid_out:          false,
        })).catch(() => null);

        await Promise.resolve(sb.from("referrals").upsert({
          referrer_wallet: validReferrer,
          referee_wallet:  sessionData.wallet,
          status:          "converted",
          converted_at:    new Date().toISOString(),
        }, { onConflict: "referee_wallet" })).catch(() => null);
      }
    }

    // Promote to dev
    const { error: userErr } = await sb
      .from("users")
      .update({ role: "dev", dev_access_type: "paid" })
      .eq("wallet", sessionData.wallet);

    if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("confirm-dev-fee error:", e);
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
