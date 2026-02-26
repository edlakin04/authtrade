import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { SUB_COOKIE_NAME, readSubToken } from "@/lib/subscription";
import { ROLE_COOKIE_NAME, readRoleToken } from "@/lib/role";

const PROTECTED_PREFIXES = ["/dashboard", "/coins", "/account", "/subscription", "/dev"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // must be signed in
  const session = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // If dev/admin => allow (no subscription needed)
  const roleToken = req.cookies.get(ROLE_COOKIE_NAME)?.value;
  if (roleToken) {
    const decodedRole = await readRoleToken(roleToken).catch(() => null);
    if (decodedRole?.role === "dev" || decodedRole?.role === "admin") {
      return NextResponse.next();
    }
  }

  // Otherwise require subscription
  const subToken = req.cookies.get(SUB_COOKIE_NAME)?.value;
  if (!subToken) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("subscribe", "1");
    return NextResponse.redirect(url);
  }

  const decodedSub = await readSubToken(subToken).catch(() => null);
  if (!decodedSub || decodedSub.paidUntilMs <= Date.now()) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("subscribe", "1");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/coins/:path*", "/account/:path*", "/subscription/:path*", "/dev/:path*"]
};
