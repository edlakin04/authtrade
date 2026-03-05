// app/api/dev/coins/[id]/banner/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const BUCKET = "coin-banners";

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

async function requireDev(wallet: string) {
  const sb = supabaseAdmin();
  const { data } = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle();
  return data?.role === "dev" || data?.role === "admin";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wallet = await getViewerWallet();
    if (!wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    if (!(await requireDev(wallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const { id } = await params;
    const coinId = (id ?? "").trim();
    if (!coinId) return NextResponse.json({ error: "Missing coin id" }, { status: 400 });

    const sb = supabaseAdmin();

    // ✅ coin ownership check (coins.wallet is the dev wallet in your schema)
    const coinRes = await sb.from("coins").select("id, wallet").eq("id", coinId).maybeSingle();
    if (coinRes.error) return NextResponse.json({ error: coinRes.error.message }, { status: 500 });
    if (!coinRes.data) return NextResponse.json({ error: "Coin not found" }, { status: 404 });

    const ownerWallet = String((coinRes.data as any).wallet ?? "");
    if (!ownerWallet || ownerWallet !== wallet) {
      return NextResponse.json({ error: "Not your coin" }, { status: 403 });
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

    const ext = extFromType(file.type);

    // ✅ stable overwrite path per coin
    const path = `coin/${coinId}/banner.${ext}`;

    const buf = Buffer.from(await file.arrayBuffer());

    // Upload (overwrite)
    const up = await sb.storage.from(BUCKET).upload(path, buf, {
      contentType: file.type,
      upsert: true
    });

    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }

    // Save path onto coin row
    const { error: uErr } = await sb.from("coins").update({ banner_path: path }).eq("id", coinId);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, path });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to upload coin banner", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
