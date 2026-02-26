import { NextResponse } from "next/server";
import { buildLoginMessage, makeNonce } from "@/lib/auth";

export async function GET() {
  const nonce = makeNonce();
  const message = buildLoginMessage(nonce);

  // Store nonce in a short-lived cookie so we can verify later without DB
  const res = NextResponse.json({ nonce, message });

  res.headers.set(
    "Set-Cookie",
    `authswap_nonce=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  return res;
}
