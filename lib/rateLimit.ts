// ─── lib/rateLimit.ts ─────────────────────────────────────────────────────────
// Per-IP rate limiting for all API routes.
//
// Uses in-memory storage by default — works immediately with zero setup.
// On Vercel, each serverless function instance has its own memory, so this
// limits per-instance not globally. That's fine — each instance handles many
// requests and the limits are generous enough for real users while still
// blocking bots and abuse.
//
// To upgrade to global rate limiting: set UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN env vars and the limiter will automatically
// switch to Redis-backed global rate limiting.
//
// Rate limit tiers:
//
//   STRICT   — Auth endpoints (nonce, verify, trial)
//              5 requests per minute per IP
//              Prevents brute-force wallet enumeration
//
//   PAYMENT  — Payment confirm endpoints
//              10 requests per minute per IP
//              Prevents signature replay probing
//
//   WRITE    — Comments, messages, votes, follows, uploads
//              30 requests per minute per IP
//              Prevents spam flooding
//
//   STANDARD — General authenticated API calls
//              120 requests per minute per IP
//              Generous for real users, still blocks bots
//
//   PUBLIC   — Public read endpoints (coins, dev profiles)
//              300 requests per minute per IP
//              Very generous — cached at edge anyway
//
//   INTERNAL — Internal cron endpoints
//              3 requests per minute per IP
//              Mostly handled by secret auth, this is a backup

export type RateLimitTier =
  | "strict"
  | "payment"
  | "write"
  | "standard"
  | "public"
  | "internal";

type WindowConfig = {
  maxRequests: number;
  windowMs:    number; // milliseconds
  blockMs:     number; // how long to block after limit hit
};

const TIER_CONFIG: Record<RateLimitTier, WindowConfig> = {
  strict:   { maxRequests: 5,   windowMs: 60_000,  blockMs: 300_000  }, // 5/min, block 5min
  payment:  { maxRequests: 10,  windowMs: 60_000,  blockMs: 120_000  }, // 10/min, block 2min
  write:    { maxRequests: 30,  windowMs: 60_000,  blockMs: 60_000   }, // 30/min, block 1min
  standard: { maxRequests: 120, windowMs: 60_000,  blockMs: 30_000   }, // 120/min, block 30s
  public:   { maxRequests: 300, windowMs: 60_000,  blockMs: 15_000   }, // 300/min, block 15s
  internal: { maxRequests: 3,   windowMs: 60_000,  blockMs: 600_000  }, // 3/min, block 10min
};

// ─── In-memory store ──────────────────────────────────────────────────────────

type Entry = {
  count:      number;
  windowStart: number;
  blockedUntil: number | null;
};

// Map of `tier:ip` → entry
const store = new Map<string, Entry>();

// Clean up stale entries every 5 minutes to prevent memory leaks
// On serverless this runs per-instance which is fine
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      const maxWindow = Math.max(...Object.values(TIER_CONFIG).map((c) => c.blockMs));
      if (now - entry.windowStart > maxWindow * 2) {
        store.delete(key);
      }
    }
  }, 5 * 60_000);
}

// ─── Redis-backed store (optional, auto-enabled if env vars present) ──────────

async function redisIncr(
  key: string,
  windowMs: number
): Promise<{ count: number; ttlMs: number } | null> {
  const url   = process.env.KV_REST_API_URL   ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    // Use Upstash REST API — no SDK needed
    const pipelineRes = await fetch(`${url}/pipeline`, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify([
        ["INCR",   key],
        ["PEXPIRE", key, Math.ceil(windowMs / 1000)],
        ["PTTL",   key],
      ]),
      signal: AbortSignal.timeout(2_000), // never block the request for more than 2s
    });

    if (!pipelineRes.ok) return null;

    const results = await pipelineRes.json();
    const count   = results?.[0]?.result ?? 1;
    const ttlMs   = results?.[2]?.result ?? windowMs;

    return { count, ttlMs };
  } catch {
    // Redis failure — fall back to in-memory
    return null;
  }
}

// ─── Main rate limit function ─────────────────────────────────────────────────

export type RateLimitResult =
  | { limited: false; remaining: number; resetMs: number }
  | { limited: true;  retryAfterMs: number; reason: string };

export async function rateLimit(
  ip: string,
  tier: RateLimitTier
): Promise<RateLimitResult> {
  const config = TIER_CONFIG[tier];
  const key    = `rl:${tier}:${ip}`;
  const now    = Date.now();

  // ── Try Redis first ────────────────────────────────────────────────────────
  const redisResult = await redisIncr(key, config.windowMs);

  if (redisResult !== null) {
    if (redisResult.count > config.maxRequests) {
      return {
        limited:      true,
        retryAfterMs: redisResult.ttlMs,
        reason:       `Rate limit exceeded. Try again in ${Math.ceil(redisResult.ttlMs / 1000)}s.`,
      };
    }
    return {
      limited:   false,
      remaining: Math.max(0, config.maxRequests - redisResult.count),
      resetMs:   now + redisResult.ttlMs,
    };
  }

  // ── In-memory fallback ─────────────────────────────────────────────────────
  const existing = store.get(key);

  // Check if currently blocked
  if (existing?.blockedUntil && now < existing.blockedUntil) {
    return {
      limited:      true,
      retryAfterMs: existing.blockedUntil - now,
      reason:       `Too many requests. Try again in ${Math.ceil((existing.blockedUntil - now) / 1000)}s.`,
    };
  }

  // Check if within current window
  if (existing && now - existing.windowStart < config.windowMs) {
    const newCount = existing.count + 1;

    if (newCount > config.maxRequests) {
      // Block them
      const blockedUntil = now + config.blockMs;
      store.set(key, { ...existing, count: newCount, blockedUntil });
      return {
        limited:      true,
        retryAfterMs: config.blockMs,
        reason:       `Too many requests. Try again in ${Math.ceil(config.blockMs / 1000)}s.`,
      };
    }

    store.set(key, { ...existing, count: newCount, blockedUntil: null });
    return {
      limited:   false,
      remaining: config.maxRequests - newCount,
      resetMs:   existing.windowStart + config.windowMs,
    };
  }

  // New window
  store.set(key, {
    count:        1,
    windowStart:  now,
    blockedUntil: null,
  });

  return {
    limited:   false,
    remaining: config.maxRequests - 1,
    resetMs:   now + config.windowMs,
  };
}

// ─── Extract real IP from Next.js middleware request ──────────────────────────

export function getIp(req: { headers: { get(name: string): string | null } }): string {
  // Vercel sets x-forwarded-for — first IP is the real client
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  // Fallback — local dev
  return "127.0.0.1";
}

// ─── Build a 429 response ─────────────────────────────────────────────────────

export function rateLimitResponse(result: Extract<RateLimitResult, { limited: true }>) {
  return new Response(
    JSON.stringify({ error: result.reason, code: "RATE_LIMITED" }),
    {
      status:  429,
      headers: {
        "Content-Type":  "application/json",
        "Retry-After":   String(Math.ceil(result.retryAfterMs / 1000)),
        "X-RateLimit-Limit": "0",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Date.now() + result.retryAfterMs),
      },
    }
  );
}

// ─── Route tier map ───────────────────────────────────────────────────────────
// Maps URL path prefixes to their rate limit tier.
// More specific paths must come before broader ones.

export function getTierForPath(pathname: string): RateLimitTier {
  // ── Strict: auth endpoints ──────────────────────────────────────────────
  if (pathname.startsWith("/api/auth/")) return "strict";

  // ── Payment: payment confirm endpoints ─────────────────────────────────
  if (pathname.startsWith("/api/payments/")) return "payment";

  // ── Internal: cron endpoints ────────────────────────────────────────────
  if (pathname.startsWith("/api/internal/")) return "internal";
  if (pathname.startsWith("/api/cron/"))     return "internal";

  // ── Write: user-generated content, social actions ───────────────────────
  if (pathname.startsWith("/api/communities/")) return "write";
  if (pathname.startsWith("/api/coins/"))       return "write";  // comments, votes
  if (pathname.startsWith("/api/follow"))        return "write";
  if (pathname.startsWith("/api/unfollow"))      return "write";
  if (pathname.startsWith("/api/dev/posts"))     return "write";
  if (pathname.startsWith("/api/dev/pfp"))       return "write";
  if (pathname.startsWith("/api/dev/banner"))    return "write";
  if (pathname.startsWith("/api/dev/golden-hour")) return "write";
  if (pathname.startsWith("/api/dev/bidding-ad")) return "write";
  if (pathname.startsWith("/api/dev/coins"))     return "write";
  if (pathname.startsWith("/api/me/"))           return "write";
  if (pathname.startsWith("/api/collab"))        return "write";
  if (pathname.startsWith("/api/referral/"))     return "write";
  if (pathname.startsWith("/api/dev/redeem-invite")) return "strict"; // treat like auth

  // ── Public: open read endpoints ─────────────────────────────────────────
  if (pathname.startsWith("/api/public/"))      return "public";
  if (pathname.startsWith("/api/prices"))        return "public";
  if (pathname.startsWith("/api/coin-chart"))    return "public";
  if (pathname.startsWith("/api/coin-trades"))   return "public";
  if (pathname.startsWith("/api/coin-live"))     return "public";
  if (pathname.startsWith("/api/coin-holders"))  return "public";
  if (pathname.startsWith("/api/portfolio"))     return "public";
  if (pathname.startsWith("/api/rpc"))           return "public"; // auth checked in route

  // ── Standard: everything else ────────────────────────────────────────────
  return "standard";
}
