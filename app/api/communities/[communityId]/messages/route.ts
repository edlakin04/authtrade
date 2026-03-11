import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireFullAccess } from "@/lib/subscription";
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

async function signCommunityImage(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;
  const { data, error } = await sb.storage.from("community").createSignedUrl(path, 60 * 30);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * GET /api/communities/:communityId/messages?limit=40&before=ISO
 * - If no `before`, return latest `limit` messages (desc)
 * - If `before`, return older messages (< before)
 * - Returns `text` + signed `image_url` for UI
 */
export async function GET(req: Request, ctx: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId } = await ctx.params;
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const trialBlock = await requireFullAccess();
  if (trialBlock) return trialBlock;

    const url = new URL(req.url);
    const limitRaw = url.searchParams.get("limit");
    const before = url.searchParams.get("before");
    const limit = Math.min(Math.max(Number(limitRaw || 40) || 40, 1), 100);

    const sb = supabaseAdmin();

    const allowed = await requireMember(sb, communityId, viewerWallet);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

    let q = sb
      .from("community_messages")
      // ✅ DB columns you actually have (+ image_path after SQL)
      .select("id, community_id, author_wallet, content, image_path, created_at")
      .eq("community_id", communityId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) q = q.lt("created_at", before);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const raw = data ?? [];

    // Sign images (private bucket) → image_url for UI display
    const signedUrls = await Promise.all(raw.map((m: any) => signCommunityImage(sb, m.image_path)));

    const messages = raw.map((m: any, i: number) => ({
      id: m.id,
      community_id: m.community_id,
      author_wallet: m.author_wallet,
      text: m.content ?? null,
      image_url: signedUrls[i] ?? null,
      created_at: m.created_at
    }));

    const nextCursor = messages.length ? messages[messages.length - 1].created_at : null;

    return NextResponse.json({
      ok: true,
      communityId,
      messages,
      nextCursor
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
 * body: { text?: string, content?: string, image_path?: string }
 */
export async function POST(req: Request, ctx: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId } = await ctx.params;
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    // accept either text (UI) or content (older)
    const content =
      typeof body?.text === "string"
        ? body.text.trim()
        : typeof body?.content === "string"
          ? body.content.trim()
          : "";

    // ✅ new: store image_path (private storage), not image_url in DB
    const image_path = typeof body?.image_path === "string" ? body.image_path.trim() : null;

    if (!content && !image_path) {
      return NextResponse.json({ error: "Message text or image is required" }, { status: 400 });
    }
    if (content.length > 4000) {
      return NextResponse.json({ error: "Message too long (max 4000 chars)" }, { status: 400 });
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
        image_path: image_path || null
      })
      .select("id, community_id, author_wallet, content, image_path, created_at")
      .single();

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    // Return signed URL for immediate UI use (optional but nice)
    const signed = await signCommunityImage(sb, inserted?.image_path ?? null);

    return NextResponse.json({
      ok: true,
      message: {
        id: inserted.id,
        community_id: inserted.community_id,
        author_wallet: inserted.author_wallet,
        text: inserted?.content ?? null,
        image_url: signed ?? null,
        created_at: inserted.created_at
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to send message", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
