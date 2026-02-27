import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

    // 1) Coin
    const { data: coinRow, error: coinErr } = await sb
      .from("coins")
      .select("id,wallet,token_address,title,description,created_at")
      .eq("id", id)
      .maybeSingle();

    if (coinErr) return NextResponse.json({ error: coinErr.message }, { status: 500 });
    if (!coinRow) return NextResponse.json({ error: "Coin not found" }, { status: 404 });

    // 2) Counts
    const [{ count: upvotesCount, error: upvoteCountErr }, { count: commentsCount, error: commentCountErr }] =
      await Promise.all([
        sb.from("coin_votes").select("*", { count: "exact", head: true }).eq("coin_id", id),
        sb.from("coin_comments").select("*", { count: "exact", head: true }).eq("coin_id", id)
      ]);

    if (upvoteCountErr) return NextResponse.json({ error: upvoteCountErr.message }, { status: 500 });
    if (commentCountErr) return NextResponse.json({ error: commentCountErr.message }, { status: 500 });

    // 3) Has viewer upvoted?
    let viewerHasUpvoted = false;
    if (viewerWallet) {
      const { data: v, error: vErr } = await sb
        .from("coin_votes")
        .select("coin_id")
        .eq("coin_id", id)
        .eq("voter_wallet", viewerWallet)
        .maybeSingle();

      if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
      viewerHasUpvoted = !!v;
    }

    // 4) Comments list (latest first)
    const { data: comments, error: commentsErr } = await sb
      .from("coin_comments")
      .select("id,coin_id,author_wallet,comment,created_at")
      .eq("coin_id", id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (commentsErr) return NextResponse.json({ error: commentsErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      viewerWallet,
      coin: {
        id: coinRow.id,
        dev_wallet: coinRow.wallet, // alias for UI consistency
        token_address: coinRow.token_address,
        title: coinRow.title,
        description: coinRow.description,
        created_at: coinRow.created_at,
        upvotes_count: upvotesCount ?? 0,
        comments_count: commentsCount ?? 0,
        viewer_has_upvoted: viewerHasUpvoted
      },
      comments: comments ?? []
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load coin", details: e?.message || String(e) },
      { status: 500 }
    );
  }
}
