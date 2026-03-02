import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFromMime(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

async function requireDev(sb: ReturnType<typeof supabaseAdmin>, wallet: string) {
  const { data: user, error } = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle();
  if (error) return { ok: false as const, status: 500 as const, error: error.message };
  if (user?.role !== "dev" && user?.role !== "admin") return { ok: false as const, status: 403 as const, error: "Not a dev" };
  return { ok: true as const };
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const session = await readSessionToken(sessionToken).catch(() => null);
  if (!session?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const sb = supabaseAdmin();

  const devCheck = await requireDev(sb, session.wallet);
  if (!devCheck.ok) return NextResponse.json({ error: devCheck.error }, { status: devCheck.status });

  // Ensure users row exists (consistent with your other endpoints)
  await sb.from("users").upsert({ wallet: session.wallet }, { onConflict: "wallet" });

  const contentType = req.headers.get("content-type") || "";

  let content = "";
  let file: File | null = null;

  // ✅ Support multipart (image upload) AND JSON (old client)
  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    const raw = fd.get("content");
    content = typeof raw === "string" ? raw.trim() : "";

    const f = fd.get("file");
    file = f instanceof File ? f : null;
  } else {
    const body = await req.json().catch(() => null);
    content = (body?.content as string | undefined)?.trim() || "";
  }

  if (!content || content.length < 2) return NextResponse.json({ error: "Post too short" }, { status: 400 });
  if (content.length > 500) return NextResponse.json({ error: "Post too long (max 500)" }, { status: 400 });

  let image_path: string | null = null;

  if (file) {
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: "Invalid file type (jpg/png/webp only)" }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 400 });
    }

    const ext = extFromMime(file.type);
    const path = `${session.wallet}/${Date.now()}_${crypto.randomUUID()}.${ext}`;

    const bytes = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await sb.storage
      .from("dev-posts")
      .upload(path, bytes, {
        contentType: file.type,
        upsert: false
      });

    if (upErr) {
      return NextResponse.json({ error: upErr.message || "Failed to upload image" }, { status: 500 });
    }

    image_path = path;
  }

  const { data: inserted, error: insErr } = await sb
    .from("dev_posts")
    .insert({
      wallet: session.wallet,
      content,
      image_path
    })
    .select("id")
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: inserted?.id ?? null });
}
