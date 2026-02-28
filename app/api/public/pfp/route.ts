import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const wallet = (url.searchParams.get("wallet") || "").trim();
    if (!wallet) return NextResponse.json({ error: "Missing wallet" }, { status: 400 });

    const sb = supabaseAdmin();

    const { data: prof, error } = await sb
      .from("dev_profiles")
      .select("pfp_path")
      .eq("wallet", wallet)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const path = prof?.pfp_path || null;
    if (!path) return NextResponse.json({ ok: true, url: null, path: null });

    const signed = await sb.storage.from("pfp").createSignedUrl(path, 60 * 60); // 1 hour
    if (signed.error) return NextResponse.json({ error: signed.error.message }, { status: 500 });

    return NextResponse.json({ ok: true, url: signed.data.signedUrl, path });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load profile picture", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
