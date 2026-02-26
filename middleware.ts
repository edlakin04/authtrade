import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { SUB_COOKIE_NAME, readSubToken } from "@/lib/subscription";

const PROTECTED_PREFIXES = ["/dashboard", "/coins", "/account", "/subscription", "/dev"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const session = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Require subscription for protected routes (we’ll exempt devs later)
  const sub = req.cookies.get(SUB_COOKIE_NAME)?.value;
  if (!sub) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("subscribe", "1");
    return NextResponse.redirect(url);
  }

  const decoded = await readSubToken(sub).catch(() => null);
  if (!decoded || decoded.paidUntilMs <= Date.now()) {
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
