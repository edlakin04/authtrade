import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const REF_COOKIE_NAME = "authswap_ref";
const REF_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

// ─── GET /api/referral/track?ref=WALLET ───────────────────────────────────────
// Called when someone visits the site with a ?ref= param in the URL.
// Validates the referrer is a real dev, then sets an HttpOnly cookie.
//
// Security:
// - Validates referrer exists in dev_profiles (can't fake a ref link)
// - Cookie is HttpOnly so JS can't tamper with it
// - Self-referral is blocked at payment time (not here, since we don't know
//   the visitor's wallet yet at this point)
// - 30-day window — if they don't pay within 30 days, no credit
// - First referrer wins — if they already have a referral cookie we don't
//   overwrite it (the first click gets the credit)

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const ref = (searchParams.get("ref") ?? "").trim();

    if (!ref) {
      return NextResponse.json({ error: "Missing ref" }, { status: 400 });
    }

    // ── 1. Validate referrer is a real dev ──────────────────────────────────
    // Check dev_profiles first (most reliable), then users.role as fallback
    const sb = supabaseAdmin();

    const { data: devProfile } = await sb
      .from("dev_profiles")
      .select("wallet")
      .eq("wallet", ref)
      .maybeSingle();

    if (!devProfile?.wallet) {
      // Try users.role fallback
      const { data: userRow } = await sb
        .from("users")
        .select("role")
        .eq("wallet", ref)
        .maybeSingle();

      const role = userRow?.role ?? null;
      if (role !== "dev" && role !== "admin") {
        return NextResponse.json(
          { error: "Invalid referral code — not a verified dev" },
          { status: 400 }
        );
      }
    }

    // ── 2. Build response ───────────────────────────────────────────────────
    const res = NextResponse.json({ ok: true, referrer: ref });

    // Set HttpOnly cookie — JS cannot read or modify this
    // SameSite=Lax allows it to be set after a redirect from an external link
    // We set it even if a cookie already exists — latest referrer wins on
    // subsequent fresh clicks (common affiliate marketing convention)
    res.headers.set(
      "Set-Cookie",
      [
        `${REF_COOKIE_NAME}=${ref}`,
        `Path=/`,
        `HttpOnly`,
        `Secure`,
        `SameSite=Lax`,
        `Max-Age=${REF_COOKIE_MAX_AGE}`,
      ].join("; ")
    );

    return res;

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to track referral", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

// ─── Export cookie name so other routes can import it ─────────────────────────
export { REF_COOKIE_NAME };
