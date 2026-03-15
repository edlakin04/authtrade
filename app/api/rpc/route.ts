import { NextResponse } from "next/server";
import { cookies }      from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── Allowed RPC methods whitelist ────────────────────────────────────────────
// Only these methods can pass through the proxy.
// Prevents someone using your Helius quota for expensive arbitrary RPC calls.

const ALLOWED_METHODS = new Set([
  // Transaction lifecycle
  "sendTransaction",
  "simulateTransaction",
  "getSignatureStatuses",
  "getTransaction",
  "getTransactions",

  // Blockhash (needed for building transactions)
  "getLatestBlockhash",
  "getRecentBlockhash",
  "getFeeForMessage",
  "isBlockhashValid",

  // Account info (wallet adapter + portfolio)
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTokenLargestAccounts",
  "getTokenSupply",

  // Block/slot info
  "getBlockHeight",
  "getSlot",
  "getEpochInfo",

  // Program queries
  "getProgramAccounts",
]);

// Internal server-to-server header
const INTERNAL_HEADER = "x-authswap-internal";

// ─── POST /api/rpc ────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: "RPC not configured" }, { status: 500 });
    }

    // Auth: either valid session cookie (browser) or internal secret (server)
    const isInternalCall = checkInternalHeader(req);
    if (!isInternalCall) {
      const authed = await checkSessionAuth();
      if (!authed) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Parse and validate body
    const bodyText = await req.text();
    if (!bodyText || bodyText.length > 50_000) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    let parsed: any;
    try { parsed = JSON.parse(bodyText); }
    catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

    // Validate all methods — handles both single and batch requests
    const requests = Array.isArray(parsed) ? parsed : [parsed];
    for (const rpcReq of requests) {
      const method = rpcReq?.method;
      if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
        return NextResponse.json(
          { error: `Method not allowed` },
          { status: 403 }
        );
      }
    }

    // Forward to Helius
    const upstream = await fetch(rpcUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    bodyText,
      signal:  AbortSignal.timeout(15_000),
    });

    const responseText = await upstream.text();

    return new NextResponse(responseText, {
      status:  upstream.status,
      headers: { "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("RPC proxy error:", e?.message);
    return NextResponse.json({ error: "RPC proxy failed" }, { status: 502 });
  }
}

// ─── OPTIONS — CORS preflight ─────────────────────────────────────────────────
export async function OPTIONS(req: Request) {
  const origin         = req.headers.get("origin") ?? "";
  const allowedOrigin  = process.env.NEXT_PUBLIC_SITE_URL ?? "https://authswap.io";

  if (origin !== allowedOrigin && !origin.includes("localhost")) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin":  origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age":       "86400",
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function checkInternalHeader(req: Request): boolean {
  const secret   = process.env.INTERNAL_RPC_SECRET;
  const provided = req.headers.get(INTERNAL_HEADER);
  if (!secret || !provided) return false;
  if (secret.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= secret.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

async function checkSessionAuth(): Promise<boolean> {
  try {
    const cookieStore  = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionToken) return false;
    const session = await readSessionToken(sessionToken).catch(() => null);
    return !!(session?.wallet);
  } catch {
    return false;
  }
}
