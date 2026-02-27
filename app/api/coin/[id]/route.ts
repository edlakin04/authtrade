import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = (params?.id || "").trim();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    // viewer wallet (optional)
    let viewerWallet: string | null = null;
    try {
      const cookieStore = await cookies();
      const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
      if (sessionToken) {
        const session = await readSessionToken(sessionToken).catch(() => null);
        viewerWallet = session?.wallet ?? null;
      }
    } catch {
      // ignore
    }

    const sb = supabaseAdmin();

    const { data: coin, error: coinErr } = await sb
      .from("coins")
      .select("id, wallet, token_address, title, description, created_at")
      .eq("id", id)
      .maybeSingle();

    if (coinErr) return NextResponse.json({ error: coinErr.message }, { status: 500 });
    if (!coin) return NextResponse.json({ error: "Coin not found" }, { status: 404 });

    const [{ count: upvotesCount }, { count: commentsCount }] = await Promise.all([
      sb.from("coin_votes").select("*", { count: "exact", head: true }).eq("coin_id", id),
      sb.from("coin_comments").select("*", { count: "exact", head: true }).eq("coin_id", id)
    ]);

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
        id: coin.id,
        dev_wallet: coin.wallet,
        token_address: coin.token_address,
        title: coin.title,
        description: coin.description,
        created_at: coin.created_at,
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
