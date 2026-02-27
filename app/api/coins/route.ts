import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Role = "user" | "dev" | "admin";

async function getViewerWalletAndRole() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return { wallet: null as string | null, role: "user" as Role };

  const session = await readSessionToken(token).catch(() => null);
  if (!session?.wallet) return { wallet: null as string | null, role: "user" as Role };

  const sb = supabaseAdmin();
  const { data: user } = await sb
    .from("users")
    .select("wallet, role")
    .eq("wallet", session.wallet)
    .maybeSingle();

  return { wallet: session.wallet, role: (user?.role ?? "user") as Role };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // optional query params
    const sort = (url.searchParams.get("sort") || "trending").toLowerCase(); // trending | newest
    const q = (url.searchParams.get("q") || "").trim();

    const { wallet: viewerWallet } = await getViewerWalletAndRole();
    const sb = supabaseAdmin();

    let query = sb
      .from("coins_with_stats")
      .select(
        "id, dev_wallet, token_address, title, description, created_at, upvotes_count, upvotes_24h, comments_count"
      );

    if (q) {
      // simple search: token_address or title
      query = query.or(`token_address.ilike.%${q}%,title.ilike.%${q}%`);
    }

    if (sort === "newest") {
      query = query.order("created_at", { ascending: false });
    } else {
      // trending default: last-24h upvotes, then total upvotes, then newest
      query = query
        .order("upvotes_24h", { ascending: false })
        .order("upvotes_count", { ascending: false })
        .order("created_at", { ascending: false });
    }

    const { data: coins, error } = await query.limit(200);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // viewer_has_upvoted map (optional but helps UI)
    let votedSet = new Set<string>();
    if (viewerWallet && coins?.length) {
      const ids = coins.map((c: any) => c.id);
      const { data: votes, error: vErr } = await sb
        .from("coin_votes")
        .select("coin_id")
        .eq("voter_wallet", viewerWallet)
        .in("coin_id", ids);

      if (!vErr && votes) votedSet = new Set(votes.map((v: any) => v.coin_id));
    }

    const out =
      (coins ?? []).map((c: any) => ({
        ...c,
        viewer_has_upvoted: viewerWallet ? votedSet.has(c.id) : false
      })) ?? [];

    return NextResponse.json({ ok: true, viewerWallet, coins: out });
  } catch (e: any) {
    return NextResponse.json({ error: "Failed to load coins", details: e?.message ?? String(e) }, { status: 500 });
  }
}
