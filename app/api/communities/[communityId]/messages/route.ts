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

async function requireMember(sb: ReturnType<typeof supabaseAdmin>, communityId: string, viewerWallet: string) {
  // Check community exists + dev wallet
  const { data: comm, error: commErr } = await sb
    .from("coin_communities")
    .select("id, dev_wallet")
    .eq("id", communityId)
    .maybeSingle();

  if (commErr) return { ok: false as const, status: 500 as const, error: commErr.message };
  if (!comm) return { ok: false as const, status: 404 as const, error: "Community not found" };

  // Dev is always allowed
  if (viewerWallet === comm.dev_wallet) return { ok: true as const };

  // Otherwise must be a member
  const { data: mem, error: memErr } = await sb
    .from("community_members")
    .select("community_id")
    .eq("community_id", communityId)
    .eq("member_wallet", viewerWallet)
    .maybeSingle();

  if (memErr) return { ok: false as const, status: 500 as const, error: memErr.message };
  if (!mem) return { ok: false as const, status: 403 as const, error: "Join the community to view messages" };

  return { ok: true as const };
}

/**
 * GET /api/communities/:communityId/messages?limit=40&before=2026-01-01T00:00:00.000Z
 * - No "load newer" button needed:
 *   - If no `before`, return latest `limit` messages (most recent chunk)
 *   - If `before`, return older messages (< before), also limited
 */
export async function GET(req: Request, ctx: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId } = await ctx.params; // ✅ Next 15 params Promise
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const limitRaw = url.searchParams.get("limit");
    const before = url.searchParams.get("before"); // ISO string cursor (created_at)

    const limit = Math.min(Math.max(Number(limitRaw || 40) || 40, 1), 100);

    const sb = supabaseAdmin();

    const allowed = await requireMember(sb, communityId, viewerWallet);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

    let q = sb
      .from("community_messages")
      .select("id, community_id, author_wallet, content, image_url, created_at")
      .eq("community_id", communityId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) {
      // load older than `before`
      q = q.lt("created_at", before);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const messages = data ?? [];
    const nextCursor = messages.length ? messages[messages.length - 1].created_at : null;

    return NextResponse.json({
      ok: true,
      communityId,
      messages,
      nextCursor // pass this into `before=` when user clicks "Load older"
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load messages", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/communities/:communityId/messages
 * body: { content?: string, image_url?: string }
 */
export async function POST(req: Request, ctx: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId } = await ctx.params; // ✅ Next 15 params Promise
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    const image_url = typeof body?.image_url === "string" ? body.image_url.trim() : null;

    if (!content && !image_url) {
      return NextResponse.json({ error: "Message content or image is required" }, { status: 400 });
    }
    if (content.length > 2000) {
      return NextResponse.json({ error: "Message too long (max 2000 chars)" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    const allowed = await requireMember(sb, communityId, viewerWallet);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

    const { data: inserted, error: insErr } = await sb
      .from("community_messages")
      .insert({
        community_id: communityId,
        author_wallet: viewerWallet,
        content: content || null,
        image_url: image_url || null
      })
      .select("id, community_id, author_wallet, content, image_url, created_at")
      .single();

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, message: inserted });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to send message", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
