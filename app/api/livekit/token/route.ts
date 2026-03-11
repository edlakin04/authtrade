import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AccessToken } from "livekit-server-sdk";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getViewerWallet(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

// ─── GET /api/livekit/token?roomName=...&communityId=... ─────────────────────
//
// Returns a signed LiveKit JWT for the requesting wallet.
//
// Devs (community owner) receive:
//   - canPublish: true  (they stream audio + video)
//   - canSubscribe: true
//
// Members / guests receive:
//   - canPublish: false  (viewer only)
//   - canSubscribe: true
//
// Anyone can get a viewer token — even without an Authswap session —
// so the stream is publicly watchable inside the community page.
// Publishing (going live) requires being the community dev owner.

export async function GET(req: Request) {
  try {
    const url          = new URL(req.url);
    const roomName     = (url.searchParams.get("roomName") ?? "").trim();
    const communityId  = (url.searchParams.get("communityId") ?? "").trim();

    if (!roomName)    return NextResponse.json({ error: "Missing roomName"    }, { status: 400 });
    if (!communityId) return NextResponse.json({ error: "Missing communityId" }, { status: 400 });

    // ── Env vars ────────────────────────────────────────────────────────────
    const apiKey    = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "LiveKit not configured (missing LIVEKIT_API_KEY / LIVEKIT_API_SECRET)" },
        { status: 500 }
      );
    }

    // ── Identify caller ──────────────────────────────────────────────────────
    const viewerWallet = await getViewerWallet();

    // ── Verify the stream room actually exists and is live ───────────────────
    const sb = supabaseAdmin();

    const { data: stream, error: streamErr } = await sb
      .from("live_streams")
      .select("id, dev_wallet, room_name, status, community_id")
      .eq("room_name", roomName)
      .eq("community_id", communityId)
      .maybeSingle();

    if (streamErr) {
      return NextResponse.json({ error: streamErr.message }, { status: 500 });
    }

    // Allow token generation if stream is live OR if the caller is the dev
    // (dev needs a token to start the stream before the row is marked live)
    const isDevOwner = !!viewerWallet && stream?.dev_wallet === viewerWallet;

    if (!stream) {
      // Stream row must exist before we hand out tokens
      return NextResponse.json({ error: "Stream not found" }, { status: 404 });
    }

    if (stream.status === "ended") {
      return NextResponse.json({ error: "Stream has ended" }, { status: 410 });
    }

    // ── Determine permissions ────────────────────────────────────────────────
    const canPublish   = isDevOwner;
    const canSubscribe = true; // everyone can watch

    // ── Identity: use wallet if signed in, otherwise a random guest id ───────
    const identity = viewerWallet ?? `guest_${crypto.randomUUID().slice(0, 8)}`;

    // ── Mint the token ───────────────────────────────────────────────────────
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      // Token valid for 6 hours — long enough for any realistic stream
      ttl: 6 * 60 * 60
    });

    at.addGrant({
      roomJoin:     true,
      room:         roomName,
      canPublish,
      canSubscribe,
      // Allow publishing data messages (for viewer count pings etc.)
      canPublishData: true,
    });

    const token = await at.toJwt();

    return NextResponse.json({
      ok:          true,
      token,
      identity,
      roomName,
      canPublish,
      canSubscribe,
      isDevOwner,
      livekitUrl:  process.env.LIVEKIT_URL ?? null,
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to generate token", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
