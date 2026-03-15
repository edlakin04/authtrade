import { NextResponse } from "next/server";
import { buildLoginMessage, makeNonce } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── GET /api/auth/nonce ──────────────────────────────────────────────────────
// Issues a one-time login nonce.
// The nonce is stored in two places:
//   1. An HttpOnly cookie on the client (so only this browser can use it)
//   2. Redis KV (if available) as a single-use token that expires in 10 minutes
//
// On verify, the Redis entry is deleted atomically — even if an attacker
// intercepts the signed message and fires verify first, the second attempt
// gets rejected because the nonce is already consumed.

async function markNonceIssued(nonce: string): Promise<void> {
  const url   = process.env.KV_REST_API_URL   ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN  ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return; // in-memory fallback — cookie is still the primary guard

  try {
    await fetch(`${url}/set/nonce:${nonce}/1/ex/600`, {
      method:  "GET",
      headers: { "Authorization": `Bearer ${token}` },
      signal:  AbortSignal.timeout(2_000),
    });
  } catch {
    // Non-fatal — nonce will still be validated via cookie
  }
}

export async function GET() {
  const nonce   = makeNonce();
  const message = buildLoginMessage(nonce);

  // Record nonce in Redis (fire and forget — non-fatal if Redis is down)
  await markNonceIssued(nonce);

  const res = NextResponse.json({ nonce, message });

  // HttpOnly cookie — JS cannot read or steal it
  res.headers.set(
    "Set-Cookie",
    `authswap_nonce=${nonce}; Path=/api/auth/verify; HttpOnly; Secure; SameSite=Strict; Max-Age=600`
  );

  return res;
}
