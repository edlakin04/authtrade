import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Holder = {
  address: string;    // token account address
  owner:   string;    // wallet that owns the token account
  amount:  number;    // UI amount (decimal adjusted)
  pct:     number;    // percentage of total supply (0-100)
};

export type HoldersPayload = {
  ok:           true;
  mint:         string;
  totalSupply:  number;
  holderCount:  number;     // from Helius DAS — real count, or null if unavailable
  holders:      Holder[];   // top 20 sorted by amount desc
  decimals:     number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRpcUrl(): string {
  const url = process.env.SOLANA_RPC_URL;
  if (!url) throw new Error("Missing SOLANA_RPC_URL env var");
  return url;
}

async function rpcCall(rpcUrl: string, method: string, params: any[]): Promise<any> {
  const res = await fetch(rpcUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id:      1,
      method,
      params,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message ?? JSON.stringify(json.error)}`);
  return json.result;
}

// ─── GET /api/coin-holders?mint=... ───────────────────────────────────────────
// Returns top 20 holders for a given SPL token mint + total supply + holder count.
//
// Data sources (all via existing SOLANA_RPC_URL / Helius):
//   getTokenLargestAccounts  — top 20 token accounts by balance
//   getTokenAccountsByOwner  — resolves wallet owner for each account
//   getTokenSupply           — total supply for percentage calculation
//   Helius DAS getAsset      — real holder count (falls back gracefully)

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mint = (searchParams.get("mint") ?? "").trim();

    if (!mint) {
      return NextResponse.json({ error: "Missing mint" }, { status: 400 });
    }

    const rpcUrl = getRpcUrl();

    // ── 1. Fetch top 20 holders + total supply in parallel ─────────────────
    const [largestResult, supplyResult] = await Promise.all([
      rpcCall(rpcUrl, "getTokenLargestAccounts", [mint, { commitment: "confirmed" }]),
      rpcCall(rpcUrl, "getTokenSupply",          [mint, { commitment: "confirmed" }]),
    ]);

    const accounts: Array<{ address: string; amount: string; uiAmount: number | null }> =
      largestResult?.value ?? [];

    const supplyInfo = supplyResult?.value;
    const decimals   = supplyInfo?.decimals ?? 0;
    const totalSupply = supplyInfo?.uiAmount ?? 0;

    if (!accounts.length || totalSupply === 0) {
      return NextResponse.json({
        ok:          true,
        mint,
        totalSupply: 0,
        holderCount: 0,
        holders:     [],
        decimals,
      } satisfies HoldersPayload);
    }

    // ── 2. Resolve owner wallet for each token account ──────────────────────
    // getMultipleAccounts returns the account data including owner (the wallet)
    const accountAddresses = accounts.map((a) => a.address);

    const multiResult = await rpcCall(rpcUrl, "getMultipleAccounts", [
      accountAddresses,
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]);

    const accountInfos: any[] = multiResult?.value ?? [];

    // ── 3. Build holder rows ────────────────────────────────────────────────
    const holders: Holder[] = [];

    for (let i = 0; i < accounts.length; i++) {
      const acct    = accounts[i];
      const info    = accountInfos[i];
      const uiAmt   = acct.uiAmount ?? 0;
      if (uiAmt <= 0) continue;

      // Parsed token account → owner is in info.data.parsed.info.owner
      const owner: string =
        info?.data?.parsed?.info?.owner ??
        acct.address; // fallback to account address if parsing fails

      const pct = totalSupply > 0 ? (uiAmt / totalSupply) * 100 : 0;

      holders.push({
        address: acct.address,
        owner,
        amount:  uiAmt,
        pct:     Math.round(pct * 100) / 100, // 2 decimal places
      });
    }

    // Sort descending by amount (should already be sorted but be safe)
    holders.sort((a, b) => b.amount - a.amount);

    // ── 4. Try to get real holder count from Helius DAS ─────────────────────
    // Helius DAS getAsset returns `ownership.supply` and `supply.print_current_supply`
    // but for fungible tokens the best source is their fungible token API.
    // We use a best-effort call — if it fails we fall back to "20+" indication.
    let holderCount = 0;

    try {
      const dasRes = await fetch(rpcUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id:      2,
          method:  "getTokenAccounts",
          params:  {
            mint,
            limit: 1,   // we only want the total count, not the data
            page:  1,
          },
        }),
        signal: AbortSignal.timeout(8_000),
      });

      if (dasRes.ok) {
        const dasJson = await dasRes.json();
        // Helius returns { total, page, limit, token_accounts }
        holderCount = dasJson?.result?.total ?? 0;
      }
    } catch {
      // DAS call failed — holderCount stays 0, UI will show top 20 only
    }

    return NextResponse.json({
      ok:          true,
      mint,
      totalSupply,
      holderCount,
      holders,
      decimals,
    } satisfies HoldersPayload);

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load holders", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
