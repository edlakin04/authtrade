// ─── lib/geoIp.ts ─────────────────────────────────────────────────────────────
// Server-side IP geolocation using ipinfo.io free tier.
// 50,000 lookups/month — only called once per subscription so well within limits.
//
// Never call this client-side — the ipinfo token must stay server-side only.
// Always fails gracefully — a geo lookup failure should never block a payment.

export type GeoResult = {
  ok:          boolean;
  countryCode: string | null;  // ISO 3166-1 alpha-2 e.g. "GB", "US", "DE"
  countryName: string | null;
  city:        string | null;
  region:      string | null;
  isVpn:       boolean;        // true if ipinfo flags it as a hosting/proxy IP
  raw:         any;            // full ipinfo response for debugging
};

// Fallback result when lookup fails — never blocks the payment flow
const FALLBACK: GeoResult = {
  ok:          false,
  countryCode: null,
  countryName: null,
  city:        null,
  region:      null,
  isVpn:       false,
  raw:         null,
};

// Map of ipinfo country codes to full country names
// Only includes countries we care about — everything else returns the code as name
const COUNTRY_NAMES: Record<string, string> = {
  GB: "United Kingdom",    US: "United States",     DE: "Germany",
  FR: "France",            IT: "Italy",             ES: "Spain",
  NL: "Netherlands",       BE: "Belgium",           AT: "Austria",
  CH: "Switzerland",       SE: "Sweden",            NO: "Norway",
  DK: "Denmark",           FI: "Finland",           PL: "Poland",
  CZ: "Czech Republic",    HU: "Hungary",           RO: "Romania",
  SK: "Slovakia",          BG: "Bulgaria",          HR: "Croatia",
  SI: "Slovenia",          EE: "Estonia",           LV: "Latvia",
  LT: "Lithuania",         LU: "Luxembourg",        MT: "Malta",
  CY: "Cyprus",            IE: "Ireland",           PT: "Portugal",
  GR: "Greece",            AU: "Australia",         NZ: "New Zealand",
  CA: "Canada",            JP: "Japan",             KR: "South Korea",
  TW: "Taiwan",            SG: "Singapore",         HK: "Hong Kong",
  IN: "India",             CN: "China",             AE: "United Arab Emirates",
  SA: "Saudi Arabia",      IL: "Israel",            TR: "Turkey",
  MX: "Mexico",            BR: "Brazil",            AR: "Argentina",
  CL: "Chile",             CO: "Colombia",          ZA: "South Africa",
  MY: "Malaysia",          ID: "Indonesia",         TH: "Thailand",
  PH: "Philippines",       VN: "Vietnam",           PK: "Pakistan",
  NG: "Nigeria",           EG: "Egypt",             KE: "Kenya",
  IS: "Iceland",           LI: "Liechtenstein",     RU: "Russia",
  BY: "Belarus",           UA: "Ukraine",           KZ: "Kazakhstan",
};

// ─── Main lookup function ─────────────────────────────────────────────────────

export async function getCountryFromIp(ip: string): Promise<GeoResult> {
  // Skip lookup for local/private IPs (development)
  if (
    !ip ||
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    ip.startsWith("172.16.") ||
    ip === "localhost"
  ) {
    return {
      ok:          true,
      countryCode: "GB",   // default to GB for local dev
      countryName: "United Kingdom",
      city:        null,
      region:      null,
      isVpn:       false,
      raw:         { _local: true },
    };
  }

  try {
    // ipinfo.io free tier — no key needed for basic lookups up to 50k/month
    // If you have an API key set it as IPINFO_TOKEN env var for higher limits
    const token   = process.env.IPINFO_TOKEN ?? "";
    const url     = token
      ? `https://ipinfo.io/${encodeURIComponent(ip)}?token=${token}`
      : `https://ipinfo.io/${encodeURIComponent(ip)}/json`;

    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal:  AbortSignal.timeout(5_000),  // 5 second timeout — never blocks payment
      cache:   "no-store",
    });

    if (!res.ok) {
      console.warn(`geoIp: ipinfo returned ${res.status} for IP ${ip}`);
      return FALLBACK;
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") {
      console.warn(`geoIp: invalid JSON from ipinfo for IP ${ip}`);
      return FALLBACK;
    }

    // ipinfo returns { ip, city, region, country, loc, org, postal, timezone }
    // "bogon: true" means it's a private/reserved IP
    if (data.bogon) {
      return {
        ok:          true,
        countryCode: null,
        countryName: null,
        city:        null,
        region:      null,
        isVpn:       false,
        raw:         data,
      };
    }

    const countryCode = (data.country ?? "").toUpperCase().trim() || null;
    const countryName = countryCode
      ? (COUNTRY_NAMES[countryCode] ?? countryCode)
      : null;

    // ipinfo flags hosting/datacenter IPs in the org field
    // e.g. "AS13335 Cloudflare, Inc." or "AS16509 Amazon.com, Inc."
    // This is a rough VPN/proxy signal — not perfect but useful for mismatch flagging
    const org    = (data.org ?? "").toLowerCase();
    const isVpn  = (
      org.includes("vpn")        ||
      org.includes("proxy")      ||
      org.includes("cloudflare") ||
      org.includes("amazon")     ||
      org.includes("digitalocean")||
      org.includes("linode")     ||
      org.includes("vultr")      ||
      org.includes("hosting")    ||
      org.includes("datacenter")
    );

    return {
      ok:          true,
      countryCode,
      countryName,
      city:        data.city   ?? null,
      region:      data.region ?? null,
      isVpn,
      raw:         data,
    };

  } catch (e: any) {
    // Never let a geo lookup error propagate — log and return fallback
    console.warn(`geoIp: lookup failed for IP ${ip}:`, e?.message ?? String(e));
    return FALLBACK;
  }
}

// ─── Extract real IP from Next.js request ────────────────────────────────────
// Handles Vercel's forwarded headers correctly

export function getIpFromRequest(req: Request): string {
  // Vercel sets x-forwarded-for with the real client IP
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list — first one is the real client
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  // Fallback headers
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "127.0.0.1";
}
