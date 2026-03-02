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

function extFromType(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  return null;
}

export async function POST(req: Request) {
  try {
    const wallet = await getViewerWallet();
    if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Missing form data" }, { status: 400 });

    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
    }

    const ext = extFromType(file.type);
    if (!ext) return NextResponse.json({ error: "Invalid file type (use JPG/PNG/WEBP)" }, { status: 400 });

    const sb = supabaseAdmin();

    await sb.from("users").upsert({ wallet }, { onConflict: "wallet" });
    await sb.from("user_profiles").upsert({ wallet }, { onConflict: "wallet" });

    const path = `${wallet}/${crypto.randomUUID()}.${ext}`;

    const arr = await file.arrayBuffer();
    const bytes = new Uint8Array(arr);

    const up = await sb.storage.from("userpfp").upload(path, bytes, {
      contentType: file.type,
      upsert: true
    });

    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

    const { error: dbErr } = await sb
      .from("user_profiles")
      .update({ pfp_path: path })
      .eq("wallet", wallet);

    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, path });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to upload profile picture", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
