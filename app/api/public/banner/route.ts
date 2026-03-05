import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = (searchParams.get("wallet") ?? "").trim();

    if (!wallet) {
      return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Read banner_path from dev_profiles
    const profRes = await sb
      .from("dev_profiles")
      .select("wallet, banner_path")
      .eq("wallet", wallet)
      .maybeSingle();

    if (profRes.error) {
      return NextResponse.json({ error: profRes.error.message }, { status: 500 });
    }

    const bannerPath = (profRes.data as any)?.banner_path ?? null;
    if (!bannerPath) {
      return NextResponse.json({ ok: true, url: null });
    }

    // Sign from the dev-banners bucket
    const { data, error } = await sb.storage.from("dev-banners").createSignedUrl(bannerPath, 60 * 30);
    if (error) {
      // Don’t hard-fail the page if storage signing fails
      return NextResponse.json({ ok: true, url: null });
    }

    return NextResponse.json({ ok: true, url: data?.signedUrl ?? null });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load banner", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
