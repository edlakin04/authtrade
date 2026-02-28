import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFromType(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "bin";
}

async function getViewerWallet() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

export async function POST(req: Request) {
  try {
    const wallet = await getViewerWallet();
    if (!wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    if (!ALLOWED.has(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: jpeg, png, webp.` },
        { status: 400 }
      );
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
    }

    const ext = extFromType(file.type);
    const path = `${wallet}/pfp.${ext}`; // stable path (overwrite)

    const buf = Buffer.from(await file.arrayBuffer());

    const sb = supabaseAdmin();

    // Upload (overwrite)
    const up = await sb.storage.from("pfp").upload(path, buf, {
      contentType: file.type,
      upsert: true
    });

    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }

    // Save path into dev_profiles
    const { error: uErr } = await sb
      .from("dev_profiles")
      .update({ pfp_path: path })
      .eq("wallet", wallet);

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, path });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to upload profile picture", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
