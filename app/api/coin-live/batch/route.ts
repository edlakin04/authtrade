import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Meta = {
  name: string | null;
  symbol: string | null;
  image: string | null;
};

function uniq(list: string[]) {
  return Array.from(new Set(list.filter(Boolean)));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mintsRaw = (url.searchParams.get("mints") || "").trim();

    if (!mintsRaw) {
      return NextResponse.json({ error: "Missing mints" }, { status: 400 });
    }

    const mints = uniq(
      mintsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ).slice(0, 50);

    // Default response map (ensure every mint exists in output)
    const byMint: Record<string, Meta> = {};
    for (const m of mints) byMint[m] = { name: null, symbol: null, image: null };

    // Jupiter token list (public, no key)
    const jupRes = await fetch("https://token.jup.ag/all", {
      cache: "no-store",
      headers: { accept: "application/json" }
    });

    if (!jupRes.ok) {
      // Return empty metas rather than failing the UI hard
      return NextResponse.json({
        ok: true,
        byMint,
        note: "Jupiter token list unavailable"
      });
    }

    const tokens = (await jupRes.json().catch(() => null)) as any[] | null;

    if (!Array.isArray(tokens)) {
      return NextResponse.json({
        ok: true,
        byMint,
        note: "Jupiter token list invalid"
      });
    }

    // Build a lookup once
    const need = new Set(mints);
    for (const t of tokens) {
      const addr = String(t?.address || "");
      if (!need.has(addr)) continue;

      byMint[addr] = {
        name: t?.name ? String(t.name) : null,
        symbol: t?.symbol ? String(t.symbol) : null,
        image: t?.logoURI ? String(t.logoURI) : null
      };
    }

    return NextResponse.json({ ok: true, byMint });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to batch load token metadata", details: e?.message || String(e) },
      { status: 500 }
    );
  }
}
