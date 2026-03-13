import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createSubToken, subCookie } from "@/lib/subscription";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  isBlockedCountry,
  getApplicableVatRate,
  getJurisdiction,
  extractVat,
  getCountryRule,
} from "@/lib/vatRules";
import { getSolGbpPrice } from "@/lib/solPrice";

const REF_COOKIE_NAME = "authswap_ref";
const USER_AFFILIATE_CUT_SOL = 0.2;  // affiliate earns 0.2 SOL per user sub payment

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const signature       = (body?.signature        as string | undefined)?.trim();
    const declaredCountry = (body?.declared_country  as string | undefined)?.trim()?.toUpperCase() ?? null;
    const ipCountry       = (body?.ip_country        as string | undefined)?.trim()?.toUpperCase() ?? null;

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    // ── Block Russia and Belarus server-side (second layer after UI) ──────
    const countryToCheck = declaredCountry ?? ipCountry;
    if (countryToCheck && isBlockedCountry(countryToCheck)) {
      return NextResponse.json({ error: "Service not available in your region" }, { status: 403 });
    }

    // Signed-in check
    const cookieStore = await cookies();
    const sessionToken   = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const refCookieValue = cookieStore.get(REF_COOKIE_NAME)?.value ?? null;
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

    // ── Resolve affiliate referrer ────────────────────────────────────────
    // Validate ref cookie: must not be self-referral, must be a real dev
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
    // Fetch threshold status so we know if VAT applies for this country
    let vatRate        = 0;
    let vatAmountSol   = 0;
    let vatAmountGbp: number | null = null;
    let solGbpRate:   number | null = null;
    let vatJurisdiction: string | null = null;
    const countryMismatch = !!(declaredCountry && ipCountry && declaredCountry !== ipCountry);

    if (declaredCountry) {
      try {
        // Fetch current threshold status
        const { data: cumulative } = await sb
          .from("vat_cumulative")
          .select("jurisdiction, threshold_crossed");

        const thresholdCrossed: Record<string, boolean> = {};
        for (const row of cumulative ?? []) {
          thresholdCrossed[row.jurisdiction] = row.threshold_crossed ?? false;
        }

        vatRate       = getApplicableVatRate(declaredCountry, thresholdCrossed);
        vatJurisdiction = getJurisdiction(declaredCountry);

        if (vatRate > 0) {
          const { vat } = extractVat(deltaSol, vatRate);
          vatAmountSol  = vat;

          // Get SOL/GBP rate for GBP equivalent
          solGbpRate    = await getSolGbpPrice();
          if (solGbpRate) {
            vatAmountGbp = Math.round(vatAmountSol * solGbpRate * 100) / 100;
          }
        }
      } catch (vatErr: any) {
        // VAT computation failure must never block the payment
        console.warn("VAT computation failed:", vatErr?.message);
      }
    }

    // ── Insert payment (dedupe by signature) ──────────────────────────────
    const { data: existingPayment } = await sb.from("payments").select("signature").eq("signature", signature).maybeSingle();
    if (existingPayment?.signature) {
      // payment already recorded, just refresh subscription token from DB
    } else {
      const { error: payErr } = await sb.from("payments").insert({
        signature,
        wallet:                  sessionData.wallet,
        kind:                    "subscription",
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
      // Increment the relevant jurisdiction's running revenue total
      if (declaredCountry) {
        try {
          const jurisdiction = vatJurisdiction ?? "NONE";
          if (jurisdiction !== "NONE" && jurisdiction !== "BLOCKED") {
            const gbpForPayment = solGbpRate ? Math.round(deltaSol * solGbpRate * 100) / 100 : 0;

            // For EU_OSS countries the native currency is EUR — we'd need EUR rate
            // For simplicity we track native as GBP for non-EUR jurisdictions
            // and approximate EUR for EU (use a fixed conversion or skip native for now)
            // The GBP total is always accurate regardless
            await sb.from("vat_cumulative")
              .update({
                revenue_gbp:    sb.rpc ? undefined : undefined, // handled below
                payment_count:  0, // handled below
                last_updated:   new Date().toISOString(),
              })
              .eq("jurisdiction", jurisdiction);

            // Use RPC increment to avoid race conditions
            await Promise.resolve(sb.rpc("increment_vat_cumulative", {
              p_jurisdiction:  jurisdiction,
              p_revenue_gbp:   gbpForPayment,
              p_revenue_native: gbpForPayment, // approximate — exact native needs FX API
              p_payment_count: 1,
            })).catch(() => null); // non-fatal
          }
        } catch (cumulErr: any) {
          console.warn("VAT cumulative update failed:", cumulErr?.message);
        }
      }

      // ── Record affiliate earning ───────────────────────────────────────
      if (validReferrer) {
        await Promise.resolve(sb.from("affiliate_earnings").insert({
          referrer_wallet:   validReferrer,
          referee_wallet:    sessionData.wallet,
          payment_signature: signature,
          amount_sol:        USER_AFFILIATE_CUT_SOL,
          kind:              "user_sub",
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
