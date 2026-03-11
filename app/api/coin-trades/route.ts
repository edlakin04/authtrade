import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Trade = {
  signature: string;
  blockTime: number;         // unix seconds
  type: "buy" | "sell";
  walletAddress: string;
  tokenAmount: number;       // base token amount
  solAmount: number | null;  // SOL spent/received (null if quote is non-SOL)
  usdAmount: number | null;  // USD value if derivable
  priceUsd: number | null;   // per-token price at trade time
  source: string | null;     // DEX name e.g. "RAYDIUM", "ORCA"
};

export type TradesPayload = {
  ok: true;
  mint: string;
  pairAddress: string | null;
  baseSymbol: string | null;
  trades: Trade[];
  txnCounts: {
    m5:  { buys: number; sells: number } | null;
    h1:  { buys: number; sells: number } | null;
    h6:  { buys: number; sells: number } | null;
    h24: { buys: number; sells: number } | null;
  };
  updatedAt: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickBestSolanaPair(pairs: any[]): any | null {
  const sol = (pairs ?? []).filter((p: any) => p?.chainId === "solana");
  if (!sol.length) return null;
  sol.sort((a: any, b: any) =>
    Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0)
  );
  return sol[0];
}

// Extract Helius API key from the RPC URL
// Supports: https://mainnet.helius-rpc.com/?api-key=KEY
//           https://rpc.helius.xyz/?api-key=KEY
function extractHeliusApiKey(rpcUrl: string): string | null {
  try {
    const u = new URL(rpcUrl);
    const key = u.searchParams.get("api-key");
    if (key) return key;
    // Some Helius URLs embed key in path: /v0/KEY/...
    const pathMatch = u.pathname.match(/\/([a-f0-9-]{36})/i);
    return pathMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

// Parse a Helius enhanced transaction into a Trade row
function parseHeliusTx(tx: any, mint: string): Trade | null {
  try {
    const sig: string = tx.signature;
    const blockTime: number = tx.timestamp ?? 0;
    const source: string | null = tx.source ?? tx.programInfo?.source ?? null;

    // Helius enhanced tx has tokenTransfers array
    const tokenTransfers: any[] = tx.tokenTransfers ?? [];
    const nativeTransfers: any[] = tx.nativeTransfers ?? [];

    // Find the transfer involving our mint
    const mintTransfer = tokenTransfers.find(
      (t: any) => t.mint === mint
    );

    if (!mintTransfer) return null;

    const tokenAmount = Math.abs(Number(mintTransfer.tokenAmount ?? 0));
    if (!tokenAmount) return null;

    // The "feePayer" / "accountData" owner who initiated — use fromUserAccount
    const walletAddress: string =
      mintTransfer.fromUserAccount ||
      mintTransfer.toUserAccount ||
      tx.feePayer ||
      "";

    // Determine buy vs sell:
    // If toUserAccount on mintTransfer matches feePayer → they received tokens → BUY
    // If fromUserAccount matches feePayer → they sent tokens → SELL
    const feePayer: string = tx.feePayer ?? "";
    const type: "buy" | "sell" =
      mintTransfer.toUserAccount === feePayer ? "buy" : "sell";

    // Derive SOL amount from native transfers (best effort)
    const lamportsTotal = nativeTransfers.reduce((sum: number, nt: any) => {
      // Only count SOL moving from/to the fee payer (not program accounts)
      if (type === "buy" && nt.fromUserAccount === feePayer) {
        return sum + Math.abs(Number(nt.amount ?? 0));
      }
      if (type === "sell" && nt.toUserAccount === feePayer) {
        return sum + Math.abs(Number(nt.amount ?? 0));
      }
      return sum;
    }, 0);

    const solAmount = lamportsTotal > 0 ? lamportsTotal / 1_000_000_000 : null;

    // Derive USD from Helius accountData token prices if present
    let usdAmount: number | null = null;
    let priceUsd: number | null = null;

    const accountData: any[] = tx.accountData ?? [];
    for (const ad of accountData) {
      const tokenBalChanges: any[] = ad.tokenBalanceChanges ?? [];
      for (const tbc of tokenBalChanges) {
        if (tbc.mint === mint && tbc.rawTokenAmount) {
          // Check if there's a usdValue in the event data
          break;
        }
      }
    }

    // Try events.swap for cleaner data (Helius parses swaps specifically)
    const swapEvent = tx.events?.swap;
    if (swapEvent) {
      const tokenIn  = swapEvent.tokenInputs?.[0];
      const tokenOut = swapEvent.tokenOutputs?.[0];

      if (tokenIn && tokenOut) {
        const isBuy = tokenOut.mint === mint;
        const relevantToken = isBuy ? tokenOut : tokenIn;
        const solToken = isBuy ? tokenIn : tokenOut;

        if (relevantToken?.mint === mint) {
          const qty = Math.abs(Number(relevantToken.rawTokenAmount?.tokenAmount ?? tokenAmount));
          const decimals = Number(relevantToken.rawTokenAmount?.decimals ?? 6);
          const uiQty = qty / Math.pow(10, decimals);

          // If the other side is SOL/WSOL
          const WSOL = "So11111111111111111111111111111111111111112";
          if (solToken?.mint === WSOL) {
            const solQty = Math.abs(Number(solToken.rawTokenAmount?.tokenAmount ?? 0));
            const solDecimals = Number(solToken.rawTokenAmount?.decimals ?? 9);
            const uiSol = solQty / Math.pow(10, solDecimals);
            if (uiSol > 0 && uiQty > 0) {
              // We don't have SOL price here, but return ratio
              return {
                signature: sig,
                blockTime,
                type: isBuy ? "buy" : "sell",
                walletAddress: feePayer,
                tokenAmount: uiQty,
                solAmount: uiSol,
                usdAmount,
                priceUsd,
                source
              };
            }
          }
        }
      }
    }

    return {
      signature: sig,
      blockTime,
      type,
      walletAddress,
      tokenAmount,
      solAmount,
      usdAmount,
      priceUsd,
      source
    };
  } catch {
    return null;
  }
}

// ─── GET /api/coin-trades?mint=...&pairAddress=...&limit=50 ───────────────────

export async function GET(req: Request) {
  try {
    const url  = new URL(req.url);
    const mint = (url.searchParams.get("mint") ?? "").trim();
    const limitParam = Math.min(Number(url.searchParams.get("limit") ?? "50"), 100);

    if (!mint) {
      return NextResponse.json({ error: "Missing mint" }, { status: 400 });
    }

    // ── 1. Get pair info from DexScreener (txn counts + pairAddress) ──────────
    const dsRes = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`,
      { cache: "no-store", headers: { accept: "application/json" } }
    );

    let pairAddress: string | null = null;
    let baseSymbol: string | null  = null;
    let txnCounts: TradesPayload["txnCounts"] = {
      m5: null, h1: null, h6: null, h24: null
    };

    if (dsRes.ok) {
      const dsJson = await dsRes.json().catch(() => null);
      const best   = pickBestSolanaPair(dsJson?.pairs ?? []);

      if (best) {
        pairAddress = best.pairAddress ?? best.id ?? null;
        baseSymbol  = best.baseToken?.symbol ?? null;

        // Parse txn counts per window
        const txns = best.txns ?? {};
        function parsePeriod(p: any) {
          if (!p) return null;
          const buys  = num(p.buys);
          const sells = num(p.sells);
          if (buys === null && sells === null) return null;
          return { buys: buys ?? 0, sells: sells ?? 0 };
        }
        txnCounts = {
          m5:  parsePeriod(txns.m5),
          h1:  parsePeriod(txns.h1),
          h6:  parsePeriod(txns.h6),
          h24: parsePeriod(txns.h24)
        };
      }
    }

    // ── 2. Fetch individual trades via Helius Enhanced Transactions API ────────
    const rpcUrl = process.env.SOLANA_RPC_URL ?? "";
    const apiKey = extractHeliusApiKey(rpcUrl);
    let trades: Trade[] = [];

    if (apiKey && pairAddress) {
      // Helius Enhanced Transactions — filtered to SWAP type on the pair address
      // This gives us the most recent swaps on that pool
      const heliusUrl =
        `https://api.helius.xyz/v0/addresses/${encodeURIComponent(pairAddress)}/transactions` +
        `?api-key=${encodeURIComponent(apiKey)}&type=SWAP&limit=${limitParam}`;

      const heliusRes = await fetch(heliusUrl, {
        cache: "no-store",
        headers: { accept: "application/json" }
      });

      if (heliusRes.ok) {
        const txList: any[] = await heliusRes.json().catch(() => []);

        for (const tx of txList) {
          const trade = parseHeliusTx(tx, mint);
          if (trade) trades.push(trade);
        }

        // If Helius swap events didn't parse cleanly, fall back to raw tx parsing
        if (trades.length === 0 && txList.length > 0) {
          // Try looser parse — just classify by net token balance change
          for (const tx of txList) {
            try {
              const sig: string      = tx.signature;
              const blockTime        = tx.timestamp ?? 0;
              const feePayer: string = tx.feePayer ?? "";
              const source: string | null = tx.source ?? null;

              const tokenTransfers: any[] = tx.tokenTransfers ?? [];
              const mintXfer = tokenTransfers.find((t: any) => t.mint === mint);
              if (!mintXfer) continue;

              const rawAmt  = Number(mintXfer.tokenAmount ?? 0);
              const tokenAmount = Math.abs(rawAmt);
              if (!tokenAmount) continue;

              const type: "buy" | "sell" =
                mintXfer.toUserAccount === feePayer ? "buy" : "sell";

              const nativeTransfers: any[] = tx.nativeTransfers ?? [];
              const lamports = nativeTransfers.reduce((s: number, nt: any) => {
                if (type === "buy"  && nt.fromUserAccount === feePayer) return s + Math.abs(Number(nt.amount ?? 0));
                if (type === "sell" && nt.toUserAccount   === feePayer) return s + Math.abs(Number(nt.amount ?? 0));
                return s;
              }, 0);

              trades.push({
                signature: sig,
                blockTime,
                type,
                walletAddress: feePayer,
                tokenAmount,
                solAmount: lamports > 0 ? lamports / 1e9 : null,
                usdAmount: null,
                priceUsd: null,
                source
              });
            } catch {
              continue;
            }
          }
        }
      }
    }

    // ── 3. Sort trades newest-first and dedupe by signature ───────────────────
    const seen = new Set<string>();
    trades = trades
      .filter((t) => {
        if (seen.has(t.signature)) return false;
        seen.add(t.signature);
        return true;
      })
      .sort((a, b) => b.blockTime - a.blockTime)
      .slice(0, limitParam);

    return NextResponse.json({
      ok: true,
      mint,
      pairAddress,
      baseSymbol,
      trades,
      txnCounts,
      updatedAt: new Date().toISOString()
    } satisfies TradesPayload);

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load trades", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
