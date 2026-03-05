// app/api/dev/banner/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { imageSize } from "image-size";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const BUCKET = "dev-banners";

// Banner-ish constraints
const MIN_RATIO = 2.2; // wider than tall
const MAX_RATIO = 4.5; // still banner-ish
const MIN_WIDTH = 900; // avoid tiny uploads
const MIN_HEIGHT = 250;

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

/**
 * A wallet is a dev if:
 *  - it has a row in dev_profiles (most reliable for your app), OR
 *  - users.role is dev/admin
 */
async function requireDev(wallet: string) {
  const sb = supabaseAdmin();

  const prof = await sb.from("dev_profiles").select("wallet").eq("wallet", wallet).maybeSingle();
  if (!prof.error && prof.data?.wallet) return true;

  const u = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle();
  const role = (u.data?.role ?? null) as string | null;
  return role === "dev" || role === "admin";
}

export async function POST(req: Request) {
  try {
    const wallet = await getViewerWallet();
    if (!wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    if (!(await requireDev(wallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    if (!ALLOWED.has(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: jpeg, png, webp." },
        { status: 400 }
      );
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // ✅ server-side banner shape validation
    let width = 0;
    let height = 0;
    try {
      const dim = imageSize(buf);
      width = Number(dim?.width || 0);
      height = Number(dim?.height || 0);
    } catch {
      return NextResponse.json({ error: "Could not read image dimensions" }, { status: 400 });
    }

    if (!width || !height) {
      return NextResponse.json({ error: "Invalid image dimensions" }, { status: 400 });
    }

    if (width < MIN_WIDTH || height < MIN_HEIGHT) {
      return NextResponse.json(
        { error: `Banner too small. Minimum is ${MIN_WIDTH}x${MIN_HEIGHT}px.` },
        { status: 400 }
      );
    }

    const ratio = width / height;
    if (!Number.isFinite(ratio) || ratio < MIN_RATIO || ratio > MAX_RATIO) {
      return NextResponse.json(
        {
          error: `Banner must be wide (recommended 1500x500). Aspect ratio must be between ${MIN_RATIO.toFixed(
            1
          )}:1 and ${MAX_RATIO.toFixed(1)}:1. Yours is ${ratio.toFixed(2)}:1.`
        },
        { status: 400 }
      );
    }

    const ext = extFromType(file.type);
    const path = `${wallet}/banner.${ext}`; // stable path (overwrite)

    const sb = supabaseAdmin();

    // Upload (overwrite)
    const up = await sb.storage.from(BUCKET).upload(path, buf, {
      contentType: file.type,
      upsert: true
    });

    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }

    // Save banner path into dev_profiles
    const { error: uErr } = await sb
      .from("dev_profiles")
      .update({ banner_path: path, banner_updated_at: new Date().toISOString() })
      .eq("wallet", wallet);

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      path,
      width,
      height,
      ratio
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to upload banner", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
