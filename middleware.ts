import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { SUB_COOKIE_NAME, readSubToken } from "@/lib/subscription";
import { ROLE_COOKIE_NAME, readRoleToken } from "@/lib/role";
import { rateLimit, getIp, getTierForPath, rateLimitResponse } from "@/lib/rateLimit";

// ─── Route classification ─────────────────────────────────────────────────────

const PROTECTED_PREFIXES = [
  "/dashboard", "/coins", "/account", "/subscription",
  "/dev", "/community", "/trade", "/coin", "/affiliate",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Rate limiting — applied to ALL API routes ─────────────────────────────
  if (pathname.startsWith("/api/")) {
    const ip     = getIp(req);
    const tier   = getTierForPath(pathname);
    const result = await rateLimit(ip, tier);

    if (result.limited) {
      return rateLimitResponse(result);
    }
  }

  // ── Page route protection ─────────────────────────────────────────────────
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // ── 1. Must be signed in ──────────────────────────────────────────────────
  const session = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // ── 2. Devs and admins bypass subscription check ──────────────────────────
  const roleToken = req.cookies.get(ROLE_COOKIE_NAME)?.value;
  if (roleToken) {
    const decodedRole = await readRoleToken(roleToken).catch(() => null);
    if (decodedRole?.role === "dev" || decodedRole?.role === "admin") {
      return NextResponse.next();
    }
  }

  // ── 3. Read sub/trial cookie ──────────────────────────────────────────────
  const subToken = req.cookies.get(SUB_COOKIE_NAME)?.value;

  if (!subToken) {
    return redirectToSubscribe(req);
  }

  const decodedSub = await readSubToken(subToken).catch(() => null);

  if (!decodedSub || decodedSub.paidUntilMs <= Date.now()) {
    return redirectToSubscribe(req);
  }

  // ── 4. Trial or paid — both get full page access ──────────────────────────
  // Write actions are blocked at the API level via requireFullAccess()
  return NextResponse.next();
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function redirectToSubscribe(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.searchParams.set("subscribe", "1");
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // All API routes get rate limited
    "/api/:path*",
    // Page routes get auth checked
    "/dashboard/:path*",
    "/coins/:path*",
    "/coin/:path*",
    "/account/:path*",
    "/subscription/:path*",
    "/dev/:path*",
    "/community/:path*",
    "/trade/:path*",
    "/affiliate/:path*",
  ],
};
