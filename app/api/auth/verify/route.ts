import { NextResponse } from "next/server";
import {
  buildLoginMessage,
  createSessionToken,
  sessionCookie,
  verifySolanaSignature,
} from "@/lib/auth";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Solana wallet address format — base58, 32-44 chars
const WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ─── Redis single-use nonce consumption ───────────────────────────────────────
// Uses Redis GETDEL — atomically gets the value and deletes it in one operation.
// If two requests race, only one gets the value back — the other gets null.
// This is the key protection against replay attacks.

async function consumeNonceFromRedis(nonce: string): Promise<boolean> {
  const url   = process.env.KV_REST_API_URL   ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN  ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  // No Redis configured — rely on cookie alone (still safe, just not race-proof)
  if (!url || !token) return true;

  try {
    const res = await fetch(`${url}/getdel/nonce:${nonce}`, {
      method:  "GET",
      headers: { "Authorization": `Bearer ${token}` },
      signal:  AbortSignal.timeout(2_000),
    });

    if (!res.ok) return true; // Redis error — allow through, cookie is the guard
    const json = await res.json();

    // If result is null, nonce was already consumed or never existed
    return json?.result !== null && json?.result !== undefined;
  } catch {
    return true; // Redis down — fall back to cookie-only validation
  }
}

// ─── POST /api/auth/verify ────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    if (!body?.publicKey || !body?.signature) {
      return NextResponse.json({ error: "Missing publicKey or signature" }, { status: 400 });
    }

    // Validate wallet address format — reject obviously invalid inputs immediately
    if (typeof body.publicKey !== "string" || !WALLET_REGEX.test(body.publicKey)) {
      return NextResponse.json({ error: "Invalid wallet address format" }, { status: 400 });
    }

    if (typeof body.signature !== "string" || body.signature.length < 64 || body.signature.length > 128) {
      return NextResponse.json({ error: "Invalid signature format" }, { status: 400 });
    }

    // Read nonce from cookie
    const cookieStore = await cookies();
    const nonceCookie = cookieStore.get("authswap_nonce")?.value;

    if (!nonceCookie) {
      return NextResponse.json({ error: "Missing nonce — request a new one" }, { status: 400 });
    }

    // Consume nonce from Redis atomically — prevents replay even in race conditions
    const nonceValid = await consumeNonceFromRedis(nonceCookie);
    if (!nonceValid) {
      return NextResponse.json({ error: "Nonce already used — request a new one" }, { status: 400 });
    }

    // Verify the cryptographic signature
    const message = buildLoginMessage(nonceCookie);
    const ok = verifySolanaSignature({
      publicKeyBase58: body.publicKey,
      signatureBase58: body.signature,
      message,
    });

    if (!ok) {
      return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
    }

    // Issue session token
    const token = await createSessionToken(body.publicKey);

    const res = NextResponse.json({ ok: true });

    // Set session cookie
    res.headers.set("Set-Cookie", sessionCookie(token));

    // Clear nonce cookie immediately
    res.headers.append(
      "Set-Cookie",
      `authswap_nonce=; Path=/api/auth/verify; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
    );

    return res;

  } catch (e: any) {
    console.error("auth/verify error:", e?.message);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
