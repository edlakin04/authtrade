// app/api/coin/[id]/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Ctx = {
  params: Promise<{ id: string }>;
};

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;

    if (!id) {
      return NextResponse.json({ error: "Missing coin id" }, { status: 400 });
    }

    // viewer wallet (optional)
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;

    let viewerWallet: string | null = null;
    if (sessionToken) {
      const session = await readSessionToken(sessionToken).catch(() => null);
      viewerWallet = session?.wallet ?? null;
    }

    const sb = supabaseAdmin();

    // coin row (coins table uses wallet as dev wallet)
    const { data: coinRow, error: coinErr } = await sb
      .from("coins")
      .select("id, wallet, token_address, title, description, created_at")
      .eq("id", id)
      .maybeSingle();

    if (coinErr) return NextResponse.json({ error: coinErr.message }, { status: 500 });
    if (!coinRow) return NextResponse.json({ error: "Coin not found" }, { status: 404 });

    // counts
    const [{ count: upvotesCount }, { count: commentsCount }] = await Promise.all([
      sb.from("coin_votes").select("*", { head: true, count: "exact" }).eq("coin_id", id),
      sb.from("coin_comments").select("*", { head: true, count: "exact" }).eq("coin_id", id)
    ]);

    // viewer_has_upvoted
    let viewerHasUpvoted = false;
    if (viewerWallet) {
      const { data: voteRow } = await sb
        .from("coin_votes")
        .select("coin_id")
        .eq("coin_id", id)
        .eq("voter_wallet", viewerWallet)
        .maybeSingle();

      viewerHasUpvoted = !!voteRow;
    }

    return NextResponse.json({
      ok: true,
      viewerWallet,
      coin: {
        id: coinRow.id,
        dev_wallet: coinRow.wallet,
        token_address: coinRow.token_address,
        title: coinRow.title,
        description: coinRow.description,
        created_at: coinRow.created_at,
        upvotes_count: upvotesCount ?? 0,
        comments_count: commentsCount ?? 0,
        viewer_has_upvoted: viewerHasUpvoted
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load coin", details: e?.message || String(e) },
      { status: 500 }
    );
  }
}
