import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/dev/batch
 * body: { wallets: string[] }
 * returns: { ok: true, profiles: [{ wallet, display_name, pfp_url }] }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const walletsRaw = Array.isArray(body?.wallets) ? body.wallets : [];

    const wallets = Array.from(
      new Set(
        walletsRaw
          .map((w: any) => (typeof w === "string" ? w.trim() : ""))
          .filter(Boolean)
      )
    ).slice(0, 200);

    if (wallets.length === 0) {
      return NextResponse.json({ ok: true, profiles: [] });
    }

    const sb = supabaseAdmin();

    // dev_profiles holds display_name + pfp_path (private bucket)
    const { data: profs, error } = await sb
      .from("dev_profiles")
      .select("wallet, display_name, pfp_path")
      .in("wallet", wallets);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    async function signedPfpUrlFromPath(path?: string | null) {
      if (!path) return null;
      const { data, error } = await sb.storage.from("pfp").createSignedUrl(path, 60 * 30);
      if (error) return null;
      return data?.signedUrl ?? null;
    }

    const rows = profs ?? [];

    // Sign in parallel (safe at this scale)
    const profiles = await Promise.all(
      rows.map(async (p: any) => ({
        wallet: p.wallet,
        display_name: p.display_name ?? null,
        pfp_url: await signedPfpUrlFromPath(p.pfp_path ?? null)
      }))
    );

    // Make sure the response includes all requested wallets (even if no dev_profile exists yet)
    const byWallet = new Map<string, any>();
    for (const p of profiles) byWallet.set(p.wallet, p);

    const ordered = wallets.map((w) => {
      const hit = byWallet.get(w);
      return (
        hit ?? {
          wallet: w,
          display_name: null,
          pfp_url: null
        }
      );
    });

    return NextResponse.json({ ok: true, profiles: ordered });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load dev batch", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
