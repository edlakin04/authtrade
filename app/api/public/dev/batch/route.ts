import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type BatchReq = {
  wallets?: unknown;
};

type ProfileRow = {
  wallet: string;
  display_name: string | null;
  pfp_url: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as BatchReq;

    const walletsRaw = Array.isArray(body.wallets) ? body.wallets : [];

    // ✅ force real string[]
    const wallets: string[] = Array.from(
      new Set(
        walletsRaw
          .map((w) => (typeof w === "string" ? w.trim() : ""))
          .filter((w): w is string => Boolean(w))
      )
    ).slice(0, 200);

    if (wallets.length === 0) {
      return NextResponse.json({ ok: true, profiles: [] satisfies ProfileRow[] });
    }

    const sb = supabaseAdmin();

    const { data: profs, error } = await sb
      .from("dev_profiles")
      .select("wallet, display_name, pfp_path")
      .in("wallet", wallets);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    async function signedPfpUrlFromPath(path?: string | null) {
      if (!path) return null;
      const { data, error } = await sb.storage.from("pfp").createSignedUrl(path, 60 * 30);
      if (error) return null;
      return data?.signedUrl ?? null;
    }

    const rows = (profs ?? []) as Array<{ wallet: string; display_name: string | null; pfp_path: string | null }>;

    const signed: ProfileRow[] = await Promise.all(
      rows.map(async (p) => ({
        wallet: p.wallet,
        display_name: p.display_name ?? null,
        pfp_url: await signedPfpUrlFromPath(p.pfp_path ?? null)
      }))
    );

    const byWallet = new Map<string, ProfileRow>();
    for (const p of signed) byWallet.set(p.wallet, p);

    // ✅ ordered list always matches requested wallets (even missing profiles)
    const ordered: ProfileRow[] = wallets.map((w) => {
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
