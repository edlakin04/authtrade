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

    const { data: comm, error: commErr } = await sb
      .from("coin_communities")
      .select("id, dev_wallet")
      .eq("id", communityId)
      .maybeSingle();

    if (commErr) return NextResponse.json({ error: commErr.message }, { status: 500 });
    if (!comm) return NextResponse.json({ error: "Community not found" }, { status: 404 });

    const role = viewerWallet === comm.dev_wallet ? "dev" : "member";

    const { error: insErr } = await sb.from("community_members").upsert(
      { community_id: communityId, member_wallet: viewerWallet, role },
      { onConflict: "community_id,member_wallet" }
    );

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to join community", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
