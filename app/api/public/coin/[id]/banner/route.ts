// app/api/public/coin/[id]/banner/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// ✅ coin banner bucket (create this in Supabase Storage)
const COIN_BANNER_BUCKETS = ["coin-banners", "coin_banners", "coinbanners"];

/**
 * Signs a coin banner path from any candidate bucket.
 * Returns a short-lived signed URL or null.
 */
async function signedCoinBannerUrl(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;

  for (const bucket of COIN_BANNER_BUCKETS) {
    try {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 60 * 30);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      // try next bucket
    }
  }

  return null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const coinId = (id ?? "").trim();
  if (!coinId) return NextResponse.json({ error: "Missing coin id" }, { status: 400 });

  const sb = supabaseAdmin();

  // We expect coins table to store banner_path (nullable).
  // If you haven't added it yet, add: ALTER TABLE coins ADD COLUMN banner_path text;
  const { data: coin, error } = await sb.from("coins").select("id, banner_path").eq("id", coinId).maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!coin) return NextResponse.json({ error: "Coin not found" }, { status: 404 });

  const url = await signedCoinBannerUrl(sb, (coin as any).banner_path ?? null);

  return NextResponse.json({ ok: true, url });
}
