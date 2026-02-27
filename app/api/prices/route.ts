import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ids = (searchParams.get("ids") || "").trim();

  if (!ids) {
    return NextResponse.json({ error: "Missing ids" }, { status: 400 });
  }

  // Use Jupiter "lite" base (recommended in their docs for Price V3)
  // Response format is: { [mint]: { usdPrice: number, ... } }
  const url = `https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(ids)}`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: "Failed to fetch prices", status: res.status, details: text },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object") {
    return NextResponse.json({ error: "Bad price response" }, { status: 502 });
  }

  return NextResponse.json(data);
}
