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

export async function POST(_req: Request, ctx: { params: { communityId: string } }) {
  try {
    const communityId = ctx.params.communityId;
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();

    // Prevent dev leaving their own community
    const { data: comm } = await sb
      .from("coin_communities")
      .select("dev_wallet")
      .eq("id", communityId)
      .maybeSingle();

    if (comm?.dev_wallet === viewerWallet) {
      return NextResponse.json({ error: "Dev cannot leave their own community" }, { status: 400 });
    }

    const { error } = await sb
      .from("community_members")
      .delete()
      .eq("community_id", communityId)
      .eq("member_wallet", viewerWallet);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to leave community", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
