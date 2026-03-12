import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { SUB_COOKIE_NAME, readSubToken } from "@/lib/subscription";
import { ROLE_COOKIE_NAME, readRoleToken } from "@/lib/role";

// ─── Route classification ─────────────────────────────────────────────────────

// All routes that require at least a session (signed in)
const PROTECTED_PREFIXES = ["/dashboard", "/coins", "/account", "/subscription", "/dev", "/community", "/trade", "/coin", "/affiliate"];

// Trial users can access ALL protected routes — actions are blocked at the API level only
// No TRIAL_ALLOWED_PREFIXES restriction needed

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // ── 1. Must be signed in ───────────────────────────────────────────────────
  const session = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // ── 2. Devs and admins bypass everything ───────────────────────────────────
  const roleToken = req.cookies.get(ROLE_COOKIE_NAME)?.value;
  if (roleToken) {
    const decodedRole = await readRoleToken(roleToken).catch(() => null);
    if (decodedRole?.role === "dev" || decodedRole?.role === "admin") {
      return NextResponse.next();
    }
  }

  // ── 3. Read sub/trial cookie ───────────────────────────────────────────────
  const subToken = req.cookies.get(SUB_COOKIE_NAME)?.value;

  // No cookie at all → redirect to subscribe
  if (!subToken) {
    return redirectToSubscribe(req, "subscribe");
  }

  const decodedSub = await readSubToken(subToken).catch(() => null);

  // Invalid or expired cookie → redirect to subscribe
  if (!decodedSub || decodedSub.paidUntilMs <= Date.now()) {
    return redirectToSubscribe(req, "subscribe");
  }

  // ── 4. Trial or paid — both get full page access ─────────────────────────
  // Write actions are blocked at the API level via requireFullAccess()
  return NextResponse.next();
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function redirectToSubscribe(req: NextRequest, reason: "subscribe" | "trial_upgrade" = "subscribe") {
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.searchParams.set("subscribe", "1");
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/coins/:path*",
    "/coin/:path*",
    "/account/:path*",
    "/subscription/:path*",
    "/dev/:path*",
    "/community/:path*",
    "/trade/:path*",
    "/affiliate/:path*",
  ]
};
