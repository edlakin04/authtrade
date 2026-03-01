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

export async function GET() {
  try {
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();

    // Membership rows
    const { data: mem, error: memErr } = await sb
      .from("community_members")
      .select("community_id, role, created_at")
      .eq("member_wallet", viewerWallet)
      .order("created_at", { ascending: false })
      .limit(200);

    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

    const ids = (mem ?? []).map((m: any) => m.community_id);
    if (!ids.length) return NextResponse.json({ ok: true, communities: [] });

    // Community details
    const { data: comms, error: commErr } = await sb
      .from("coin_communities")
      .select("id, coin_id, dev_wallet, title, created_at")
      .in("id", ids);

    if (commErr) return NextResponse.json({ error: commErr.message }, { status: 500 });

    // Join the membership info back in
    const roleById = new Map(ids.map((id: string) => [id, null]));
    for (const m of mem ?? []) roleById.set(m.community_id, m.role);

    const out = (comms ?? []).map((c: any) => ({
      ...c,
      viewerRole: roleById.get(c.id) ?? "member"
    }));

    return NextResponse.json({ ok: true, communities: out });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load communities", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
