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

async function requireMember(sb: ReturnType<typeof supabaseAdmin>, communityId: string, viewerWallet: string) {
  const { data: comm, error: commErr } = await sb
    .from("coin_communities")
    .select("id, dev_wallet")
    .eq("id", communityId)
    .maybeSingle();

  if (commErr) return { ok: false as const, status: 500, error: commErr.message };
  if (!comm) return { ok: false as const, status: 404, error: "Community not found" };

  if (comm.dev_wallet === viewerWallet) return { ok: true as const, comm };

  const { data: mem, error: memErr } = await sb
    .from("community_members")
    .select("community_id")
    .eq("community_id", communityId)
    .eq("member_wallet", viewerWallet)
    .maybeSingle();

  if (memErr) return { ok: false as const, status: 500, error: memErr.message };
  if (!mem) return { ok: false as const, status: 403, error: "Join community to view messages" };

  return { ok: true as const, comm };
}

export async function GET(req: Request, ctx: { params: { communityId: string } }) {
  try {
    const communityId = ctx.params.communityId;
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();

    const gate = await requireMember(sb, communityId, viewerWallet);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? 50);
    const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 50));

    const before = url.searchParams.get("before");
    const beforeIso = before && !Number.isNaN(Date.parse(before)) ? before : null;

    let q = sb
      .from("community_messages")
      .select("id, community_id, author_wallet, content, created_at")
      .eq("community_id", communityId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (beforeIso) {
      q = q.lt("created_at", beforeIso);
    }

    const { data: msgs, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const messages = msgs ?? [];

    // Map author -> display_name / pfp_url (optional nice UX)
    const wallets = Array.from(new Set(messages.map((m: any) => m.author_wallet)));
    let profilesByWallet: Record<string, { display_name: string; pfp_url: string | null }> = {};

    if (wallets.length) {
      const { data: profs } = await sb
        .from("dev_profiles")
        .select("wallet, display_name, pfp_url")
        .in("wallet", wallets);

      for (const p of profs ?? []) {
        profilesByWallet[p.wallet] = { display_name: p.display_name, pfp_url: p.pfp_url };
      }
    }

    const out = messages.map((m: any) => ({
      ...m,
      author: profilesByWallet[m.author_wallet] ?? null
    }));

    const nextCursor = out.length ? out[out.length - 1].created_at : null;

    return NextResponse.json({ ok: true, messages: out, nextCursor });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load messages", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, ctx: { params: { communityId: string } }) {
  try {
    const communityId = ctx.params.communityId;
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();

    const gate = await requireMember(sb, communityId, viewerWallet);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const body = await req.json().catch(() => ({}));
    const content = typeof body?.content === "string" ? body.content.trim() : "";

    if (!content) return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
    if (content.length > 4000) return NextResponse.json({ error: "Message too long" }, { status: 400 });

    const { data: msg, error } = await sb
      .from("community_messages")
      .insert({ community_id: communityId, author_wallet: viewerWallet, content })
      .select("id, community_id, author_wallet, content, created_at")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, message: msg });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to post message", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
