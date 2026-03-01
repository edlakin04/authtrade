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
  const { data: comm, error: commErr } = await sb
    .from("coin_communities")
    .select("id, dev_wallet")
    .eq("id", communityId)
    .maybeSingle();

  if (commErr) return { ok: false as const, status: 500 as const, error: commErr.message };
  if (!comm) return { ok: false as const, status: 404 as const, error: "Community not found" };

  if (viewerWallet === comm.dev_wallet) return { ok: true as const };

  const { data: mem, error: memErr } = await sb
    .from("community_members")
    .select("community_id")
    .eq("community_id", communityId)
    .eq("member_wallet", viewerWallet)
    .maybeSingle();

  if (memErr) return { ok: false as const, status: 500 as const, error: memErr.message };
  if (!mem) return { ok: false as const, status: 403 as const, error: "Join the community to upload images" };

  return { ok: true as const };
}

function safeExtFromType(mime: string) {
  const m = (mime || "").toLowerCase();
  if (m === "image/png") return "png";
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  return null;
}

export async function POST(req: Request, ctx: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId } = await ctx.params;
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();

    const allowed = await requireMember(sb, communityId, viewerWallet);
    if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    if (file.size > 7 * 1024 * 1024) {
      return NextResponse.json({ error: "Image too large (max 7MB)" }, { status: 400 });
    }

    const ext = safeExtFromType(file.type);
    if (!ext) {
      return NextResponse.json({ error: "Unsupported file type (PNG/JPG/WEBP/GIF)" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const filename = `${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
    const path = `${communityId}/${viewerWallet}/${filename}`;

    const { error: upErr } = await sb.storage.from("community").upload(path, bytes, {
      contentType: file.type,
      upsert: false
    });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const { data: signed, error: signErr } = await sb.storage.from("community").createSignedUrl(path, 60 * 30);
    if (signErr) return NextResponse.json({ error: signErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, path, url: signed?.signedUrl ?? null });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to upload image", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
