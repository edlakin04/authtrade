import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { RoomServiceClient } from "livekit-server-sdk";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createNotificationsForWallets } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getViewerWallet(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLiveKitServiceClient() {
  const apiKey    = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url       = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !url) {
    throw new Error("LiveKit not configured — missing LIVEKIT_API_KEY, LIVEKIT_API_SECRET or LIVEKIT_URL");
  }

  // RoomServiceClient expects https:// not wss://
  const httpUrl = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  return new RoomServiceClient(httpUrl, apiKey, apiSecret);
}

// ─── POST /api/livekit/stream ─────────────────────────────────────────────────
// Start a new live stream for a community.
// Only the community's dev owner can call this.
//
// Body: { communityId, title?, hasVideo? }
//
// Creates the LiveKit room, inserts a live_streams row,
// notifies all community members.

export async function POST(req: Request) {
  try {
    const devWallet = await getViewerWallet();
    if (!devWallet) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const communityId = (body.communityId ?? "").trim();
    const title       = (body.title       ?? "").trim() || null;
    const hasVideo    = !!body.hasVideo;

    if (!communityId) {
      return NextResponse.json({ error: "Missing communityId" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // ── Verify caller is the community dev owner ───────────────────────────
    const { data: comm, error: commErr } = await sb
      .from("coin_communities")
      .select("id, dev_wallet, title")
      .eq("id", communityId)
      .maybeSingle();

    if (commErr) return NextResponse.json({ error: commErr.message }, { status: 500 });
    if (!comm)   return NextResponse.json({ error: "Community not found" }, { status: 404 });

    if (comm.dev_wallet !== devWallet) {
      return NextResponse.json({ error: "Only the community dev can go live" }, { status: 403 });
    }

    // ── Check no existing active stream for this community ─────────────────
    const { data: existing } = await sb
      .from("live_streams")
      .select("id, room_name")
      .eq("community_id", communityId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "A stream is already live for this community", roomName: existing.room_name },
        { status: 409 }
      );
    }

    // ── Generate a unique room name ────────────────────────────────────────
    // Format: community_{communityId_prefix}_{timestamp} for easy debugging
    const roomName = `community_${communityId.slice(0, 8)}_${Date.now()}`;

    // ── Create the LiveKit room ────────────────────────────────────────────
    const svc = getLiveKitServiceClient();

    await svc.createRoom({
      name:                roomName,
      // Auto-delete room 30s after last participant leaves
      emptyTimeout:        30,
      // Hard cap — well above any realistic community audience
      maxParticipants:     2000,
    });

    // ── Insert live_streams row ────────────────────────────────────────────
    const { data: stream, error: insertErr } = await sb
      .from("live_streams")
      .insert({
        community_id: communityId,
        dev_wallet:   devWallet,
        room_name:    roomName,
        title,
        has_video:    hasVideo,
        status:       "live",
      })
      .select("id, room_name, started_at")
      .single();

    if (insertErr) {
      // Best-effort: delete the LiveKit room we just created
      await svc.deleteRoom(roomName).catch(() => null);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // ── Notify all community members ───────────────────────────────────────
    try {
      const { data: members } = await sb
        .from("community_members")
        .select("member_wallet")
        .eq("community_id", communityId)
        .neq("member_wallet", devWallet); // don't notify yourself

      const memberWallets = (members ?? []).map((m) => m.member_wallet);

      if (memberWallets.length > 0) {
        const communityTitle = comm.title ?? "your community";
        await createNotificationsForWallets({
          recipientWallets: memberWallets,
          actorWallet:      devWallet,
          type:             "stream_started",
          title:            `🔴 Live now in ${communityTitle}`,
          body:             title ?? (hasVideo ? "Video + audio stream" : "Audio stream"),
          link:             `/community/${communityId}`,
        });
      }
    } catch {
      // Never let notification failure kill the stream start
    }

    return NextResponse.json({
      ok:         true,
      streamId:   stream.id,
      roomName:   stream.room_name,
      startedAt:  stream.started_at,
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to start stream", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/livekit/stream ───────────────────────────────────────────────
// End an active stream.
// Only the dev who started it can end it (or pass forceEnd=true for admin use).
//
// Body: { roomName, communityId }

export async function DELETE(req: Request) {
  try {
    const devWallet = await getViewerWallet();
    if (!devWallet) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body        = await req.json().catch(() => ({}));
    const roomName    = (body.roomName    ?? "").trim();
    const communityId = (body.communityId ?? "").trim();

    if (!roomName || !communityId) {
      return NextResponse.json({ error: "Missing roomName or communityId" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // ── Find the stream ────────────────────────────────────────────────────
    const { data: stream, error: findErr } = await sb
      .from("live_streams")
      .select("id, dev_wallet")
      .eq("room_name", roomName)
      .eq("community_id", communityId)
      .maybeSingle();

    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
    // Row already gone — stream was already ended
    if (!stream) return NextResponse.json({ ok: true, alreadyEnded: true });

    if (stream.dev_wallet !== devWallet) {
      return NextResponse.json({ error: "Only the dev who started the stream can end it" }, { status: 403 });
    }

    // ── Delete the row from DB ─────────────────────────────────────────────
    // Ended streams have no use — delete outright instead of updating status.
    const { error: deleteErr } = await sb
      .from("live_streams")
      .delete()
      .eq("id", stream.id);

    if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

    // ── Delete the LiveKit room (kicks all participants) ───────────────────
    try {
      const svc = getLiveKitServiceClient();
      await svc.deleteRoom(roomName);
    } catch {
      // Room may have already auto-closed — not a fatal error
    }

    return NextResponse.json({ ok: true, ended: true });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to end stream", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

// ─── GET /api/livekit/stream?communityId=... ──────────────────────────────────
// Check if a community currently has an active stream.
// Returns the stream row if live, null if not.
// Used by the community page to show/hide the live banner on load.

export async function GET(req: Request) {
  try {
    const url         = new URL(req.url);
    const communityId = (url.searchParams.get("communityId") ?? "").trim();

    if (!communityId) {
      return NextResponse.json({ error: "Missing communityId" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Any row in live_streams is by definition live — ended rows are deleted
    const { data: stream, error } = await sb
      .from("live_streams")
      .select("id, room_name, dev_wallet, title, has_video, viewer_count, started_at")
      .eq("community_id", communityId)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      ok:     true,
      stream: stream ?? null,
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to check stream", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
