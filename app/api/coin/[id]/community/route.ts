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

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: coinId } = await ctx.params; // ✅ Next 15: params is a Promise
    const viewerWallet = await getViewerWallet();
    const sb = supabaseAdmin();

    const { data: comm, error: commErr } = await sb
      .from("coin_communities")
      .select("id, coin_id, dev_wallet, title, created_at")
      .eq("coin_id", coinId)
      .maybeSingle();

    if (commErr) return NextResponse.json({ error: commErr.message }, { status: 500 });

    if (!comm) {
      return NextResponse.json({ ok: true, community: null, viewerIsMember: false });
    }

    let viewerIsMember = false;

    if (viewerWallet) {
      if (viewerWallet === comm.dev_wallet) {
        viewerIsMember = true;
      } else {
        const { data: mem } = await sb
          .from("community_members")
          .select("community_id")
          .eq("community_id", comm.id)
          .eq("member_wallet", viewerWallet)
          .maybeSingle();

        viewerIsMember = !!mem;
      }
    }

    return NextResponse.json({ ok: true, community: comm, viewerIsMember });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load community", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: coinId } = await ctx.params; // ✅ Next 15: params is a Promise
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const title = typeof body?.title === "string" ? body.title.trim() : null;

    const sb = supabaseAdmin();

    // Verify coin exists + is owned by this dev
    const { data: coin, error: coinErr } = await sb
      .from("coins")
      .select("id, wallet")
      .eq("id", coinId)
      .maybeSingle();

    if (coinErr) return NextResponse.json({ error: coinErr.message }, { status: 500 });
    if (!coin) return NextResponse.json({ error: "Coin not found" }, { status: 404 });
    if (coin.wallet !== viewerWallet) {
      return NextResponse.json({ error: "Only the coin owner can create the community" }, { status: 403 });
    }

    // Create community (idempotent-ish: if already exists, return it)
    const { data: existing } = await sb
      .from("coin_communities")
      .select("id, coin_id, dev_wallet, title, created_at")
      .eq("coin_id", coinId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, community: existing });
    }

    const { data: created, error: createErr } = await sb
      .from("coin_communities")
      .insert({ coin_id: coinId, dev_wallet: viewerWallet, title: title || null })
      .select("id, coin_id, dev_wallet, title, created_at")
      .single();

    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });

    // Ensure dev is a member
    await sb.from("community_members").upsert(
      { community_id: created.id, member_wallet: viewerWallet, role: "dev" },
      { onConflict: "community_id,member_wallet" }
    );

    return NextResponse.json({ ok: true, community: created });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to create community", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
