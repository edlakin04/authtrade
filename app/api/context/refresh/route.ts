import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createSubToken, createTrialSubToken, subCookie, trialEndsAtMs } from "@/lib/subscription";
import { createRoleToken, roleCookie } from "@/lib/role";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const TRIAL_DAYS = 7;

export async function POST() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ ok: false }, { status: 401 });

  const sessionData = await readSessionToken(sessionToken).catch(() => null);
  if (!sessionData?.wallet) return NextResponse.json({ ok: false }, { status: 401 });

  const wallet = sessionData.wallet;
  const sb = supabaseAdmin();

  // Ensure user exists and fetch role + trial state in one query
  await sb.from("users").upsert({ wallet }, { onConflict: "wallet" });

  const { data: userRow } = await sb
    .from("users")
    .select("role, trial_started_at")
    .eq("wallet", wallet)
    .maybeSingle();

  const role = (userRow?.role === "dev" || userRow?.role === "admin")
    ? userRow.role
    : "user";

  // ── Paid subscription ──────────────────────────────────────────────────────
  const { data: subRow } = await sb
    .from("subscriptions")
    .select("paid_until")
    .eq("wallet", wallet)
    .maybeSingle();

  const paidUntilMs = subRow?.paid_until
    ? new Date(subRow.paid_until).getTime()
    : 0;
  const subscribedActive = paidUntilMs > Date.now();

  // ── Trial state ────────────────────────────────────────────────────────────
  const trialStartedAt = userRow?.trial_started_at ?? null;
  const trialStartedAtMs = trialStartedAt ? new Date(trialStartedAt).getTime() : null;
  const trialExpiresAtMs = trialStartedAtMs ? trialEndsAtMs(trialStartedAtMs) : null;
  const trialActive  = !subscribedActive && trialExpiresAtMs !== null && trialExpiresAtMs > Date.now();
  const trialExpired = trialExpiresAtMs !== null && trialExpiresAtMs <= Date.now();
  const trialEligible = trialStartedAt === null && !subscribedActive;

  const daysRemaining = trialActive && trialExpiresAtMs
    ? Math.max(0, Math.ceil((trialExpiresAtMs - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  // ── Build response ─────────────────────────────────────────────────────────
  const res = NextResponse.json({
    ok: true,
    role,
    // Paid sub
    subscribedActive,
    paidUntilMs,
    // Trial
    isTrial:      trialActive,
    trialActive,
    trialExpired,
    trialEligible,
    daysRemaining,
    trialExpiresAtMs: trialExpiresAtMs ?? null,
  });

  // ── Set role cookie ────────────────────────────────────────────────────────
  const roleToken = await createRoleToken({ wallet, role });
  res.headers.append("Set-Cookie", roleCookie(roleToken));

  // ── Set sub cookie ─────────────────────────────────────────────────────────
  // Priority: paid sub > active trial. Expired trial gets nothing → middleware
  // redirects them to subscribe. Never-used trial also gets nothing here —
  // they activate it explicitly via POST /api/auth/trial.
  if (subscribedActive) {
    const subToken = await createSubToken({ wallet, paidUntilMs });
    res.headers.append("Set-Cookie", subCookie(subToken));
  } else if (trialActive && trialStartedAtMs) {
    const subToken = await createTrialSubToken({ wallet, trialStartedAtMs });
    res.headers.append("Set-Cookie", subCookie(subToken));
  }

  return res;
}
