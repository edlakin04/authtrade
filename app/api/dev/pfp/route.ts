import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

function extFromMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const session = await readSessionToken(token).catch(() => null);
    const wallet = session?.wallet ? String(session.wallet) : "";
    if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "Only PNG/JPG/WEBP images are allowed" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large (max 2MB)" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = extFromMime(file.type);

    // overwrite stable path so the latest avatar always wins
    const path = `${wallet}/avatar.${ext}`;

    const sb = supabaseAdmin();

    // upload to Supabase Storage bucket "pfp"
    const up = await sb.storage.from("pfp").upload(path, bytes, {
      contentType: file.type,
      upsert: true,
      cacheControl: "3600"
    });

    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }

    // public url (bucket should be public)
    const pub = sb.storage.from("pfp").getPublicUrl(path);
    const publicUrl = pub?.data?.publicUrl ? String(pub.data.publicUrl) : "";

    if (!publicUrl) {
      return NextResponse.json({ error: "Failed to get public URL" }, { status: 500 });
    }

    // update dev profile row
    const { error: uErr } = await sb
      .from("dev_profiles")
      .update({ pfp_url: publicUrl, updated_at: new Date().toISOString() })
      .eq("wallet", wallet);

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, pfp_url: publicUrl });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to upload profile picture", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
