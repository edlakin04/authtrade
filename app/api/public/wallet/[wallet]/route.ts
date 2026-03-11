import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// ─── RPC helper (mirrors /api/portfolio pattern) ──────────────────────────────
async function rpc(origin: string, method: string, params: any[] = []) {
  const res = await fetch(`${origin}/api/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store"
  });

  if (!res.ok) throw new Error(`RPC ${method} failed (${res.status})`);
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`RPC ${method} returned non-JSON`);
  if (json?.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

// ─── GET /api/public/wallet/[wallet] ─────────────────────────────────────────
// Returns the subset of a wallet's SPL token holdings that are Authswap coins.
// Each row includes: coin db record, on-chain token amount, USD price + value.

export async function GET(
  req: Request,
  ctx: { params: Promise<{ wallet: string }> }
) {
  try {
    const { wallet } = await ctx.params;
    const owner = (wallet ?? "").trim();

    if (!owner) return NextResponse.json({ error: "Missing wallet" }, { status: 400 });

    const origin = new URL(req.url).origin;
    const sb = supabaseAdmin();

    // ── 1. Fetch SOL balance + SPL token accounts in parallel ───────────────
    const [balResult, tokenAccounts] = await Promise.all([
      rpc(origin, "getBalance", [owner, { commitment: "confirmed" }]),
      rpc(origin, "getTokenAccountsByOwner", [
        owner,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed", commitment: "confirmed" }
      ])
    ]);

    const WSOL_MINT = "So11111111111111111111111111111111111111112";
    const lamports = Number(balResult?.value ?? 0);
    const sol = lamports / 1_000_000_000;

    type RawToken = { mint: string; uiAmount: number; decimals: number };

    const allTokens: RawToken[] = (tokenAccounts?.value ?? [])
      .map((acc: any) => {
        const info = acc?.account?.data?.parsed?.info;
        return {
          mint: String(info?.mint ?? ""),
          uiAmount: Number(info?.tokenAmount?.uiAmount ?? 0),
          decimals: Number(info?.tokenAmount?.decimals ?? 0)
        };
      })
      .filter((t: RawToken) => t.mint && t.uiAmount > 0);

    if (allTokens.length === 0) {
      return NextResponse.json({ ok: true, owner, sol, solUsdPrice, solUsdValue, holdings: [] });
    }

    // ── 2. Filter to only mints that exist in the Authswap coins table ─────────
    const allMints = allTokens.map((t) => t.mint);

    const { data: matchedCoins, error: coinsErr } = await sb
      .from("coins")
      .select("id, wallet, token_address, title, description, created_at")
      .in("token_address", allMints);

    if (coinsErr) return NextResponse.json({ error: coinsErr.message }, { status: 500 });

    const authswapCoins = matchedCoins ?? [];
    if (authswapCoins.length === 0) {
      return NextResponse.json({ ok: true, owner, sol, solUsdPrice, solUsdValue, holdings: [] });
    }

    // Map mint -> coin db record
    const coinByMint = new Map(authswapCoins.map((c) => [c.token_address, c]));

    // Only keep tokens whose mint is an Authswap coin
    const authswapTokens = allTokens.filter((t) => coinByMint.has(t.mint));
    const authswapMints = authswapTokens.map((t) => t.mint);

    // ── 3. Fetch USD prices for matched mints + WSOL (for SOL price) ──────────
    let priceMap: Record<string, { usdPrice?: number }> = {};
    try {
      const priceIds = [WSOL_MINT, ...authswapMints];
      const priceRes = await fetch(
        `${origin}/api/prices?ids=${encodeURIComponent(priceIds.join(","))}`,
        { cache: "no-store" }
      );
      if (priceRes.ok) priceMap = await priceRes.json().catch(() => ({}));
    } catch {
      // prices are best-effort — don't fail the whole request
    }

    const solUsdPrice = Number(priceMap?.[WSOL_MINT]?.usdPrice ?? 0) || null;
    const solUsdValue = solUsdPrice && sol > 0 ? sol * solUsdPrice : null;

    // ── 4. Fetch dev profile names + pfp for each coin's dev ─────────────────
    const devWallets = Array.from(new Set(authswapCoins.map((c) => c.wallet)));
    const { data: devProfiles } = await sb
      .from("dev_profiles")
      .select("wallet, display_name, pfp_path")
      .in("wallet", devWallets);

    // Sign pfp urls
    const devMap = new Map<string, { display_name: string | null; pfp_url: string | null }>();
    for (const p of devProfiles ?? []) {
      let pfp_url: string | null = null;
      if (p.pfp_path) {
        const { data: signed } = await sb.storage
          .from("dev-pfps")
          .createSignedUrl(p.pfp_path, 60 * 30);
        pfp_url = signed?.signedUrl ?? null;
      }
      devMap.set(p.wallet, { display_name: p.display_name ?? null, pfp_url });
    }

    // ── 5. Assemble final holdings list ───────────────────────────────────────
    const holdings = authswapTokens.map((t) => {
      const coin = coinByMint.get(t.mint)!;
      const usdPrice = Number(priceMap?.[t.mint]?.usdPrice ?? 0) || null;
      const usdValue = usdPrice ? t.uiAmount * usdPrice : null;
      const dev = devMap.get(coin.wallet);

      return {
        // On-chain
        mint: t.mint,
        uiAmount: t.uiAmount,
        decimals: t.decimals,
        usdPrice,
        usdValue,

        // Authswap coin record
        coin: {
          id: coin.id,
          wallet: coin.wallet,
          token_address: coin.token_address,
          title: coin.title,
          description: coin.description,
          created_at: coin.created_at
        },

        // Dev who launched the coin
        dev: {
          wallet: coin.wallet,
          display_name: dev?.display_name ?? null,
          pfp_url: dev?.pfp_url ?? null
        }
      };
    });

    // Sort by USD value desc, then by uiAmount desc
    holdings.sort((a, b) => {
      if (a.usdValue !== null && b.usdValue !== null) return b.usdValue - a.usdValue;
      if (a.usdValue !== null) return -1;
      if (b.usdValue !== null) return 1;
      return b.uiAmount - a.uiAmount;
    });

    const totalUsd = holdings.reduce((sum, h) => sum + (h.usdValue ?? 0), 0);

    return NextResponse.json({
      ok: true,
      owner,
      sol,
      solUsdPrice,
      solUsdValue,
      totalUsd: totalUsd > 0 ? totalUsd : null,
      holdings
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load wallet", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
