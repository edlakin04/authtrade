import { NextResponse } from "next/server";

// This proxy forwards Solana JSON-RPC to your private RPC (Helius) server-side.
// Browser -> /api/rpc (same-origin) -> Helius RPC (server-side)
export async function POST(req: Request) {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json({ error: "Missing SOLANA_RPC_URL" }, { status: 500 });
  }

  const bodyText = await req.text();

  const upstream = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: bodyText
  });

  const text = await upstream.text();

  // Return upstream response, and allow the browser to call this endpoint
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type": "application/json",
      // CORS for your own endpoint (safe because it’s your server)
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}
