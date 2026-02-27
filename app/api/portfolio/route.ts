import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RpcReq = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: any[];
};

async function rpc(urlOrigin: string, method: string, params: any[] = []) {
  const body: RpcReq = { jsonrpc: "2.0", id: 1, method, params };

  const res = await fetch(`${urlOrigin}/api/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RPC ${method} failed (${res.status}): ${text}`);
  }

  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`RPC ${method} returned non-JSON response`);
  if (json?.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const owner = (url.searchParams.get("owner") || "").trim();
    if (!owner) {
      return NextResponse.json({ error: "Missing owner" }, { status: 400 });
    }

    const origin = url.origin;

    // ✅ SOL balance
    // getBalance returns: { context: {...}, value: number }
    const balResult = await rpc(origin, "getBalance", [owner, { commitment: "confirmed" }]);
    const lamports = Number(balResult?.value ?? 0);
    const sol = lamports / 1_000_000_000;

    // ✅ SPL tokens (parsed)
    const tokenAccounts = await rpc(origin, "getTokenAccountsByOwner", [
      owner,
      { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { encoding: "jsonParsed", commitment: "confirmed" }
    ]);

    const tokens: Array<{ mint: string; uiAmount: number; decimals: number }> =
      (tokenAccounts?.value || []).map((acc: any) => {
        const info = acc?.account?.data?.parsed?.info;
        const mint = String(info?.mint || "");
        const tokenAmount = info?.tokenAmount;

        const uiAmount = Number(tokenAmount?.uiAmount ?? 0);
        const decimals = Number(tokenAmount?.decimals ?? 0);

        return { mint, uiAmount, decimals };
      }) || [];

    const nonZero = tokens.filter((t) => t.mint && t.uiAmount > 0);

    // ✅ Include WSOL mint so SOL can have USD price too
    const WSOL_MINT = "So11111111111111111111111111111111111111112";
    const ids = [WSOL_MINT, ...nonZero.map((t) => t.mint)].slice(0, 50);

    // ✅ Fetch prices (best effort)
    let priceMap: Record<string, { usdPrice?: number }> = {};
    if (ids.length) {
      const priceRes = await fetch(`${origin}/api/prices?ids=${encodeURIComponent(ids.join(","))}`, {
        cache: "no-store"
      });

      if (priceRes.ok) {
        priceMap = (await priceRes.json().catch(() => ({}))) || {};
      }
    }

    const solUsd = Number(priceMap?.[WSOL_MINT]?.usdPrice ?? 0);
    const solUsdValue = solUsd > 0 ? sol * solUsd : null;

    const tokenRows = nonZero.map((t) => {
      const usdPrice = Number(priceMap?.[t.mint]?.usdPrice ?? 0);
      const usdValue = usdPrice > 0 ? t.uiAmount * usdPrice : null;

      return {
        ...t,
        usdPrice: usdPrice > 0 ? usdPrice : null,
        usdValue
      };
    });

    const totalUsd =
      (solUsdValue ?? 0) + tokenRows.reduce((sum, r) => sum + (r.usdValue ?? 0), 0);

    return NextResponse.json({
      ok: true,
      owner,
      sol,
      solUsd: solUsd > 0 ? solUsd : null,
      solUsdValue,
      totalUsd: totalUsd > 0 ? totalUsd : null,
      tokens: tokenRows
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to build portfolio", details: e?.message || String(e) },
      { status: 500 }
    );
  }
}
