import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function getViewerWallet() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

export async function POST(_req: Request, ctx: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId } = await ctx.params; // ✅ Next 15: params is a Promise
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();

    // Make sure community exists
    const { data: comm, error: commErr } = await sb
      .from("coin_communities")
      .select("id, dev_wallet")
      .eq("id", communityId)
      .maybeSingle();

    if (commErr) return NextResponse.json({ error: commErr.message }, { status: 500 });
    if (!comm) return NextResponse.json({ error: "Community not found" }, { status: 404 });

    // Dev cannot "leave" their own community (keeps invariants simple)
    if (viewerWallet === comm.dev_wallet) {
      return NextResponse.json({ error: "Dev cannot leave their own community" }, { status: 400 });
    }

    const { error: delErr } = await sb
      .from("community_members")
      .delete()
      .eq("community_id", communityId)
      .eq("member_wallet", viewerWallet);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to leave community", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
