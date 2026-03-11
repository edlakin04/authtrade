import { SignJWT, jwtVerify } from "jose";

export const SUB_COOKIE_NAME = "authswap_sub";

const TRIAL_DAYS = 7;

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing AUTH_SECRET env var");
  return new TextEncoder().encode(secret);
}

// ─── Paid subscription token ──────────────────────────────────────────────────

export async function createSubToken(params: { wallet: string; paidUntilMs: number }) {
  const key = getSecretKey();
  return await new SignJWT({
    wallet:      params.wallet,
    paidUntilMs: params.paidUntilMs,
    isTrial:     false,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("90d")
    .sign(key);
}

// ─── Trial token ──────────────────────────────────────────────────────────────
// Identical structure to the paid token but carries isTrial: true.
// The middleware lets it through to /coins and /dev only.
// API action routes reject it with 403.

export async function createTrialSubToken(params: { wallet: string; trialStartedAtMs: number }) {
  const key = getSecretKey();
  const trialEndsAtMs = params.trialStartedAtMs + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  return await new SignJWT({
    wallet:      params.wallet,
    paidUntilMs: trialEndsAtMs, // middleware uses this for expiry check
    isTrial:     true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    // JWT expires when trial expires — no need for longer TTL
    .setExpirationTime(Math.floor(trialEndsAtMs / 1000))
    .sign(key);
}

// ─── Read either token type ───────────────────────────────────────────────────

export async function readSubToken(token: string) {
  const key = getSecretKey();
  const { payload } = await jwtVerify(token, key);

  const wallet      = payload.wallet;
  const paidUntilMs = payload.paidUntilMs;
  const isTrial     = payload.isTrial === true;

  if (typeof wallet !== "string") return null;
  if (typeof paidUntilMs !== "number") return null;

  return { wallet, paidUntilMs, isTrial };
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

export function subCookie(token: string) {
  return `${SUB_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000`;
}

export function clearSubCookie() {
  return `${SUB_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ─── Shared helper ────────────────────────────────────────────────────────────

export function trialEndsAtMs(trialStartedAtMs: number): number {
  return trialStartedAtMs + TRIAL_DAYS * 24 * 60 * 60 * 1000;
}

// ─── Trial gate helper ────────────────────────────────────────────────────────
// Import and call at the top of any write API route to block trial users.
// Returns a NextResponse 403 if trial user, null if full access.
//
// Usage in any route:
//   import { requireFullAccess } from "@/lib/subscription";
//   const blocked = await requireFullAccess();
//   if (blocked) return blocked;

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function requireFullAccess(): Promise<Response | null> {
  try {
    const cookieStore = await cookies();
    const subToken = cookieStore.get(SUB_COOKIE_NAME)?.value;
    if (!subToken) return null; // no token — route's own auth handles it

    const decoded = await readSubToken(subToken).catch(() => null);
    if (!decoded) return null; // invalid token — route's own auth handles it

    if (decoded.isTrial) {
      return NextResponse.json(
        {
          error:   "Free trial accounts cannot perform this action.",
          code:    "TRIAL_RESTRICTED",
          upgrade: true,
        },
        { status: 403 }
      );
    }

    return null; // full access — proceed
  } catch {
    return null; // never block on unexpected errors
  }
}
