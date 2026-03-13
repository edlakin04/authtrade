import { NextResponse }             from "next/server";
import { cookies }                  from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getCountryFromIp, getIpFromRequest } from "@/lib/geoIp";
import { getCountryRule, isBlockedCountry, getApplicableVatRate } from "@/lib/vatRules";
import { supabaseAdmin }            from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// ─── GET /api/vat/lookup ──────────────────────────────────────────────────────
// Called by the subscription modal when it opens.
// Detects the user's country from their IP address server-side.
// Returns:
//   - detected country code + name
//   - whether the country is blocked (Russia/Belarus)
//   - current VAT rate for that country given threshold status
//   - whether VAT is currently active for that country
//   - current threshold status for all jurisdictions (so UI can show info)
//
// Never blocks a subscription — if geo fails the modal just shows
// the dropdown without a pre-selected country.
//
// Auth: requires a valid session (user must be signed in to subscribe)

export async function GET(req: Request) {
  try {
    // ── Auth check ───────────────────────────────────────────────────────
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const session = sessionToken
      ? await readSessionToken(sessionToken).catch(() => null)
      : null;

    // Don't block if not signed in — the modal shows before sign in
    // We still do the geo lookup, just don't require auth

    // ── Get IP and detect country ────────────────────────────────────────
    const ip  = getIpFromRequest(req);
    const geo = await getCountryFromIp(ip);

    const detectedCode = geo.countryCode ?? null;
    const detectedName = geo.countryName ?? null;

    // ── Check if blocked ─────────────────────────────────────────────────
    const blocked = detectedCode ? isBlockedCountry(detectedCode) : false;

    // ── Fetch current threshold status from DB ───────────────────────────
    const sb = supabaseAdmin();
    const { data: cumulative } = await sb
      .from("vat_cumulative")
      .select("jurisdiction, threshold_crossed, revenue_gbp, revenue_native, threshold_amount, native_currency")
      .order("jurisdiction");

    // Build threshold crossed map: { UK: true, EU_OSS: false, ... }
    const thresholdCrossed: Record<string, boolean> = {};
    const thresholdProgress: Record<string, {
      revenuGbp:      number;
      revenueNative:  number;
      thresholdAmount: number | null;
      nativeCurrency: string;
      crossed:        boolean;
      pctUsed:        number | null;
    }> = {};

    for (const row of cumulative ?? []) {
      thresholdCrossed[row.jurisdiction] = row.threshold_crossed ?? false;
      thresholdProgress[row.jurisdiction] = {
        revenuGbp:       Number(row.revenue_gbp      ?? 0),
        revenueNative:   Number(row.revenue_native   ?? 0),
        thresholdAmount: row.threshold_amount ? Number(row.threshold_amount) : null,
        nativeCurrency:  row.native_currency ?? "",
        crossed:         row.threshold_crossed ?? false,
        pctUsed:         row.threshold_amount
          ? Math.min(100, Math.round((Number(row.revenue_native) / Number(row.threshold_amount)) * 100 * 10) / 10)
          : null,
      };
    }

    // ── Get VAT info for detected country ────────────────────────────────
    let countryVatRate  = 0;
    let vatActive       = false;
    let countryRule     = null;

    if (detectedCode && !blocked) {
      const rate = getApplicableVatRate(detectedCode, thresholdCrossed);
      countryVatRate = rate;
      vatActive      = rate > 0;
      countryRule    = getCountryRule(detectedCode);
    }

    return NextResponse.json({
      ok:            true,
      ip,
      detected: {
        countryCode:  detectedCode,
        countryName:  detectedName,
        city:         geo.city,
        region:       geo.region,
        isVpn:        geo.isVpn,
        lookupOk:     geo.ok,
      },
      blocked,
      vatRate:        countryVatRate,
      vatActive,
      jurisdiction:   countryRule?.jurisdiction ?? null,
      taxName:        countryRule?.taxName ?? null,
      obligation:     countryRule?.obligation ?? null,
      thresholdCrossed,
      thresholdProgress,
    });

  } catch (e: any) {
    // Never crash the subscription flow — return a safe fallback
    console.error("vat/lookup error:", e?.message ?? String(e));
    return NextResponse.json({
      ok:       false,
      error:    "Lookup failed",
      detected: { countryCode: null, countryName: null, lookupOk: false },
      blocked:  false,
      vatRate:  0,
      vatActive: false,
      thresholdCrossed: {},
      thresholdProgress: {},
    });
  }
}
