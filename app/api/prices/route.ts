import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ids = (searchParams.get("ids") || "").trim();

  if (!ids) {
    return NextResponse.json({ error: "Missing ids" }, { status: 400 });
  }

  // Optional: if you later set an API key in env, we’ll include it.
  const apiKey = process.env.JUP_API_KEY;

  const url = `https://api.jup.ag/price/v3?ids=${encodeURIComponent(ids)}`;

  const res = await fetch(url, {
    headers: apiKey ? { "x-api-key": apiKey } : undefined,
    // avoid caching stale prices
    cache: "no-store"
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: "Failed to fetch prices", status: res.status, details: text },
      { status: 502 }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
