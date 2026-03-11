import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createTrialSubToken, subCookie } from "@/lib/subscription";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const TRIAL_DAYS = 7;
const TRIAL_MS   = TRIAL_DAYS * 24 * 60 * 60 * 1000;

// ─── POST /api/auth/trial ─────────────────────────────────────────────────────
// Activates a one-time 7-day free trial for the signed-in wallet.
//
// Rules:
//   - Must be signed in (session cookie required)
//   - trial_started_at must be NULL (never used a trial before)
//   - If they already have an active paid subscription, return 409 (no need for trial)
//   - Sets trial_started_at = now() in the users table
//   - Issues a sub cookie valid for 7 days with isTrial=true so middleware lets them through
//
// The trial cookie grants READ-ONLY access:
//   - /coins and /dev pages are accessible
//   - All write actions (comments, votes, join community, reviews) are blocked at API level

export async function POST() {
  try {
    // ── 1. Require sign-in ───────────────────────────────────────────────────
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

    // ── 2. Ensure user row exists, then read trial + subscription state ───────
    await sb.from("users").upsert({ wallet }, { onConflict: "wallet" });

    const { data: userRow, error: userErr } = await sb
      .from("users")
      .select("trial_started_at")
      .eq("wallet", wallet)
      .maybeSingle();

    if (userErr) {
      return NextResponse.json({ error: userErr.message }, { status: 500 });
    }

    // ── 3. Check they haven't already used a trial ────────────────────────────
    if (userRow?.trial_started_at) {
      return NextResponse.json(
        {
          error: "Trial already used",
          code:  "TRIAL_ALREADY_USED",
          message:
            "You've already used your free trial. Please subscribe to continue.",
        },
        { status: 409 }
      );
    }

    // ── 4. Check if they already have an active paid subscription ────────────
    const { data: subRow } = await sb
      .from("subscriptions")
      .select("paid_until")
      .eq("wallet", wallet)
      .maybeSingle();

    const paidUntilMs = subRow?.paid_until
      ? new Date(subRow.paid_until).getTime()
      : 0;

    if (paidUntilMs > Date.now()) {
      return NextResponse.json(
        {
          error:   "Already subscribed",
          code:    "ALREADY_SUBSCRIBED",
          message: "You already have an active subscription.",
        },
        { status: 409 }
      );
    }

    // ── 5. Activate the trial ─────────────────────────────────────────────────
    const now = new Date();
    const trialStartedAt = now.toISOString();
    const trialEndsAtMs  = now.getTime() + TRIAL_MS;

    const { error: updateErr } = await sb
      .from("users")
      .update({ trial_started_at: trialStartedAt })
      .eq("wallet", wallet);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // ── 6. Issue a trial sub cookie ───────────────────────────────────────────
    // We reuse the existing sub cookie mechanism but pass the trial end time.
    // The middleware just checks paidUntilMs > now — it doesn't care if it's
    // a trial or paid. The isTrial flag is read by the frontend (context/refresh)
    // to show the trial banner and block write actions at the API level.
    const subToken = await createTrialSubToken({
      wallet,
      trialStartedAtMs: now.getTime(),
    });

    const res = NextResponse.json({
      ok:             true,
      trialStartedAt,
      trialEndsAtMs,
      trialEndsAt:    new Date(trialEndsAtMs).toISOString(),
      daysRemaining:  TRIAL_DAYS,
    });

    res.headers.append("Set-Cookie", subCookie(subToken));

    return res;

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to activate trial", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

// ─── GET /api/auth/trial ──────────────────────────────────────────────────────
// Returns the current trial status for the signed-in wallet.
// Used by the landing page and subscription page to show correct CTAs.

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionToken) {
      return NextResponse.json({ signedIn: false });
    }

    const session = await readSessionToken(sessionToken).catch(() => null);
    if (!session?.wallet) {
      return NextResponse.json({ signedIn: false });
    }

    const wallet = session.wallet;
    const sb = supabaseAdmin();

    const { data: userRow } = await sb
      .from("users")
      .select("trial_started_at")
      .eq("wallet", wallet)
      .maybeSingle();

    const { data: subRow } = await sb
      .from("subscriptions")
      .select("paid_until")
      .eq("wallet", wallet)
      .maybeSingle();

    const trialStartedAt = userRow?.trial_started_at ?? null;
    const trialEndsAtMs  = trialStartedAt
      ? new Date(trialStartedAt).getTime() + TRIAL_MS
      : null;

    const trialActive  = trialEndsAtMs !== null && trialEndsAtMs > Date.now();
    const trialExpired = trialEndsAtMs !== null && trialEndsAtMs <= Date.now();
    const trialEligible = trialStartedAt === null;

    const paidUntilMs = subRow?.paid_until
      ? new Date(subRow.paid_until).getTime()
      : 0;
    const subscribedActive = paidUntilMs > Date.now();

    const daysRemaining = trialActive && trialEndsAtMs
      ? Math.max(0, Math.ceil((trialEndsAtMs - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;

    return NextResponse.json({
      signedIn:        true,
      wallet,
      trialEligible,
      trialActive,
      trialExpired,
      trialStartedAt,
      trialEndsAtMs,
      daysRemaining,
      subscribedActive,
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to check trial status", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
