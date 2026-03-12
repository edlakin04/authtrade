import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const WSOL_MINT = "So11111111111111111111111111111111111111112";

// ─── GET /api/affiliate/stats ─────────────────────────────────────────────────
// Returns all affiliate data for the signed-in dev:
//   - Their referral link
//   - Total referral count (pending + converted)
//   - Per-kind earnings breakdown (user_sub / dev_sub)
//   - Total SOL earned (unpaid + paid out)
//   - Total SOL pending payout
//   - SOL price for USD conversion
//   - Full earnings history (most recent first)

export async function GET(req: Request) {
  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────
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
    const sb = supabaseAdmin();

    // ── 2. Confirm caller is a dev ────────────────────────────────────────
    const { data: devProfile } = await sb
      .from("dev_profiles")
      .select("wallet")
      .eq("wallet", wallet)
      .maybeSingle();

    if (!devProfile?.wallet) {
      const { data: userRow } = await sb
        .from("users")
        .select("role")
        .eq("wallet", wallet)
        .maybeSingle();
      if (userRow?.role !== "dev" && userRow?.role !== "admin") {
        return NextResponse.json({ error: "Dev access required" }, { status: 403 });
      }
    }

    // ── 3. Fetch all data in parallel ─────────────────────────────────────
    const [referralsRes, earningsRes] = await Promise.all([
      // All referrals this dev has generated
      sb
        .from("referrals")
        .select("id, referee_wallet, status, created_at, converted_at")
        .eq("referrer_wallet", wallet)
        .order("created_at", { ascending: false }),

      // All earnings rows for this dev
      sb
        .from("affiliate_earnings")
        .select("id, referee_wallet, payment_signature, amount_sol, kind, paid_out, created_at")
        .eq("referrer_wallet", wallet)
        .order("created_at", { ascending: false }),
    ]);

    const referrals = referralsRes.data ?? [];
    const earnings  = earningsRes.data ?? [];

    // ── 4. Compute summary stats ──────────────────────────────────────────
    const totalReferrals  = referrals.length;
    const pendingReferrals   = referrals.filter((r) => r.status === "pending").length;
    const convertedReferrals = referrals.filter((r) => r.status === "converted").length;

    // Earnings breakdown
    const totalEarnedSol = earnings.reduce((sum, e) => sum + Number(e.amount_sol), 0);
    const pendingPayoutSol = earnings
      .filter((e) => !e.paid_out)
      .reduce((sum, e) => sum + Number(e.amount_sol), 0);
    const paidOutSol = earnings
      .filter((e) => e.paid_out)
      .reduce((sum, e) => sum + Number(e.amount_sol), 0);

    const userSubEarnings = earnings
      .filter((e) => e.kind === "user_sub")
      .reduce((sum, e) => sum + Number(e.amount_sol), 0);
    const devSubEarnings = earnings
      .filter((e) => e.kind === "dev_sub")
      .reduce((sum, e) => sum + Number(e.amount_sol), 0);

    // ── 5. Fetch SOL price for USD display ────────────────────────────────
    // Best-effort — if it fails, USD values will be null
    let solUsdPrice: number | null = null;
    try {
      const origin = new URL(req.url).origin;
      const priceRes = await fetch(
        `${origin}/api/prices?ids=${encodeURIComponent(WSOL_MINT)}`,
        { cache: "no-store" }
      );
      if (priceRes.ok) {
        const priceMap = await priceRes.json().catch(() => ({}));
        const price = Number(priceMap?.[WSOL_MINT]?.usdPrice ?? 0);
        if (price > 0) solUsdPrice = price;
      }
    } catch {
      // non-fatal
    }

    // ── 6. Build referral link ────────────────────────────────────────────
    const origin = new URL(req.url).origin;
    const referralLink = `${origin}/?ref=${encodeURIComponent(wallet)}`;

    // ── 7. Return ─────────────────────────────────────────────────────────
    return NextResponse.json({
      ok: true,
      wallet,
      referralLink,

      // Referral counts
      totalReferrals,
      pendingReferrals,
      convertedReferrals,

      // Earnings in SOL
      totalEarnedSol:    Math.round(totalEarnedSol    * 1e9) / 1e9,
      pendingPayoutSol:  Math.round(pendingPayoutSol  * 1e9) / 1e9,
      paidOutSol:        Math.round(paidOutSol        * 1e9) / 1e9,
      userSubEarnings:   Math.round(userSubEarnings   * 1e9) / 1e9,
      devSubEarnings:    Math.round(devSubEarnings    * 1e9) / 1e9,

      // USD conversion
      solUsdPrice,
      totalEarnedUsd:   solUsdPrice ? Math.round(totalEarnedSol   * solUsdPrice * 100) / 100 : null,
      pendingPayoutUsd: solUsdPrice ? Math.round(pendingPayoutSol * solUsdPrice * 100) / 100 : null,
      paidOutUsd:       solUsdPrice ? Math.round(paidOutSol       * solUsdPrice * 100) / 100 : null,

      // Full history
      earnings: earnings.map((e) => ({
        id:               e.id,
        referee_wallet:   e.referee_wallet,
        payment_signature: e.payment_signature,
        amount_sol:       Number(e.amount_sol),
        amount_usd:       solUsdPrice ? Math.round(Number(e.amount_sol) * solUsdPrice * 100) / 100 : null,
        kind:             e.kind,
        paid_out:         e.paid_out,
        created_at:       e.created_at,
      })),

      referrals: referrals.map((r) => ({
        id:             r.id,
        referee_wallet: r.referee_wallet,
        status:         r.status,
        created_at:     r.created_at,
        converted_at:   r.converted_at,
      })),
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load affiliate stats", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
