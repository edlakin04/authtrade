import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function getViewerWallet() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

async function safeReadJson(req: Request): Promise<any | null> {
  try {
    return await req.json();
  } catch {
    try {
      const txt = await req.text();
      if (!txt) return null;
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId } = await ctx.params;
    if (!communityId) return NextResponse.json({ error: "Missing community id" }, { status: 400 });

    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await safeReadJson(req);
    const message_id =
      body?.message_id === null ? null : typeof body?.message_id === "string" ? body.message_id.trim() : undefined;

    if (message_id === undefined) {
      return NextResponse.json({ error: "message_id is required (uuid string or null)" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Load community to confirm dev ownership
    const { data: comm, error: commErr } = await sb
      .from("coin_communities")
      .select("id, dev_wallet")
      .eq("id", communityId)
      .maybeSingle();

    if (commErr) return NextResponse.json({ error: commErr.message }, { status: 500 });
    if (!comm) return NextResponse.json({ error: "Community not found" }, { status: 404 });

    if (viewerWallet !== comm.dev_wallet) {
      return NextResponse.json({ error: "Only the dev can pin/unpin messages" }, { status: 403 });
    }

    // If pinning, verify message belongs to this community
    if (message_id) {
      const { data: msg, error: msgErr } = await sb
        .from("community_messages")
        .select("id, community_id")
        .eq("id", message_id)
        .maybeSingle();

      if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });
      if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });
      if (msg.community_id !== communityId) {
        return NextResponse.json({ error: "Message does not belong to this community" }, { status: 400 });
      }
    }

    const { error: upErr } = await sb
      .from("coin_communities")
      .update({ pinned_message_id: message_id })
      .eq("id", communityId);

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, pinned_message_id: message_id });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to pin message", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
