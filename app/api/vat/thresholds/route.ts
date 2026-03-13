import { NextResponse }    from "next/server";
import { supabaseAdmin }   from "@/lib/supabaseAdmin";
import {
  JURISDICTION_THRESHOLDS,
  THRESHOLD_JURISDICTIONS,
  IMMEDIATE_JURISDICTIONS,
  getJurisdictionName,
} from "@/lib/vatRules";

export const dynamic = "force-dynamic";

// ─── GET /api/vat/thresholds ──────────────────────────────────────────────────
// Public-ish endpoint — no auth required since it only returns aggregate
// threshold progress data, no personal payment data.
// Used by:
//   - Admin site VAT page for threshold progress bars
//   - Admin site batch export for VAT section
//   - Admin dashboard warning banner
//
// Returns:
//   - Per jurisdiction: cumulative revenue GBP + native, threshold %, crossed status
//   - Immediate VAT jurisdictions: cumulative revenue and payment counts
//   - Any jurisdictions within 20% of their threshold (warning level)
//   - Any jurisdictions within 5% of their threshold (critical level)
//   - Total all-time VAT owed across all jurisdictions in GBP

export async function GET() {
  try {
    const sb = supabaseAdmin();

    // ── Fetch all cumulative data ─────────────────────────────────────────
    const { data: cumulative, error: cumErr } = await sb
      .from("vat_cumulative")
      .select("*")
      .order("jurisdiction");

    if (cumErr) {
      return NextResponse.json({ error: cumErr.message }, { status: 500 });
    }

    // ── Fetch registration numbers ────────────────────────────────────────
    const { data: registrations } = await sb
      .from("vat_registrations")
      .select("jurisdiction, registration_no, registered_at, notes");

    const regByJurisdiction: Record<string, {
      registrationNo: string | null;
      registeredAt:   string | null;
      notes:          string | null;
    }> = {};

    for (const r of registrations ?? []) {
      regByJurisdiction[r.jurisdiction] = {
        registrationNo: r.registration_no ?? null,
        registeredAt:   r.registered_at   ?? null,
        notes:          r.notes           ?? null,
      };
    }

    // ── Build per-jurisdiction summary ────────────────────────────────────
    const byJurisdiction: Record<string, any> = {};

    for (const row of cumulative ?? []) {
      const j             = row.jurisdiction as string;
      const revenueGbp    = Number(row.revenue_gbp      ?? 0);
      const revenueNative = Number(row.revenue_native   ?? 0);
      const threshold     = row.threshold_amount ? Number(row.threshold_amount) : null;
      const crossed       = row.threshold_crossed ?? false;
      const vatRate       = Number(row.vat_rate    ?? 0);
      const paymentCount  = Number(row.payment_count ?? 0);
      const isImmediate   = (IMMEDIATE_JURISDICTIONS as readonly string[]).includes(j);

      // Percentage of threshold used (null for immediate jurisdictions)
      const pctUsed = threshold
        ? Math.min(100, Math.round((revenueNative / threshold) * 100 * 10) / 10)
        : null;

      // Warning levels
      const warningLevel: "none" | "warning" | "critical" | "crossed" =
        crossed                          ? "crossed"  :
        pctUsed !== null && pctUsed >= 95 ? "critical" :
        pctUsed !== null && pctUsed >= 80 ? "warning"  :
        "none";

      // VAT owed in GBP — only meaningful once threshold crossed or immediate
      // For threshold jurisdictions: only count VAT from payments after threshold crossed
      // We approximate here — exact per-payment VAT is in the payments table
      // For the summary we use: revenueGbp * vatRate (post-threshold revenue)
      // The batch export does the precise per-payment calculation
      const vatOwedGbp = (crossed || isImmediate)
        ? Math.round(revenueGbp * vatRate / (1 + vatRate) * 100) / 100
        : 0;

      const thresholdInfo = JURISDICTION_THRESHOLDS[j] ?? null;
      const reg           = regByJurisdiction[j] ?? null;

      byJurisdiction[j] = {
        jurisdiction:     j,
        jurisdictionName: getJurisdictionName(j),
        isImmediate,
        isThreshold:      (THRESHOLD_JURISDICTIONS as readonly string[]).includes(j),

        // Revenue
        revenueGbp,
        revenueNative,
        nativeCurrency:   row.native_currency ?? "GBP",
        paymentCount,

        // Threshold
        thresholdAmount:  threshold,
        thresholdCurrency: row.threshold_currency ?? null,
        thresholdLabel:   thresholdInfo?.label ?? null,
        crossed,
        crossedAt:        row.threshold_crossed_at ?? null,
        pctUsed,
        warningLevel,

        // VAT
        vatRate,
        vatRateDisplay:   vatRate > 0 ? `${Math.round(vatRate * 100 * 10) / 10}%` : "0%",
        taxAuthority:     thresholdInfo?.taxAuthority ?? row.jurisdiction,
        vatOwedGbp,

        // Registration
        registrationNo:   reg?.registrationNo ?? null,
        registeredAt:     reg?.registeredAt   ?? null,
        registrationNotes: reg?.notes         ?? null,

        lastUpdated:      row.last_updated ?? null,
      };
    }

    // ── Aggregate warnings ────────────────────────────────────────────────
    const warnings: Array<{
      jurisdiction:     string;
      jurisdictionName: string;
      warningLevel:     "warning" | "critical";
      pctUsed:          number;
      thresholdLabel:   string;
    }> = [];

    for (const [j, data] of Object.entries(byJurisdiction)) {
      if (data.warningLevel === "warning" || data.warningLevel === "critical") {
        warnings.push({
          jurisdiction:     j,
          jurisdictionName: data.jurisdictionName,
          warningLevel:     data.warningLevel,
          pctUsed:          data.pctUsed,
          thresholdLabel:   data.thresholdLabel ?? "",
        });
      }
    }

    // ── Totals ────────────────────────────────────────────────────────────
    const totalVatOwedGbp = Math.round(
      Object.values(byJurisdiction)
        .reduce((sum: number, d: any) => sum + (d.vatOwedGbp ?? 0), 0)
      * 100
    ) / 100;

    const totalRevenueGbp = Math.round(
      Object.values(byJurisdiction)
        .reduce((sum: number, d: any) => sum + (d.revenueGbp ?? 0), 0)
      * 100
    ) / 100;

    // ── Crossed jurisdictions ─────────────────────────────────────────────
    const crossedJurisdictions = Object.values(byJurisdiction)
      .filter((d: any) => d.crossed && d.isThreshold)
      .map((d: any) => d.jurisdiction);

    const immediateWithRevenue = Object.values(byJurisdiction)
      .filter((d: any) => d.isImmediate && d.revenueGbp > 0)
      .map((d: any) => d.jurisdiction);

    return NextResponse.json({
      ok:                    true,
      byJurisdiction,
      warnings,
      hasWarnings:           warnings.length > 0,
      hasCritical:           warnings.some((w) => w.warningLevel === "critical"),
      crossedJurisdictions,
      immediateWithRevenue,
      totalVatOwedGbp,
      totalRevenueGbp,
      lastUpdated:           new Date().toISOString(),
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load VAT thresholds", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
