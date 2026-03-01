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

function extractCommunityIdFromUrl(req: Request) {
  // /api/communities/<communityId>
  const { pathname } = new URL(req.url);
  const parts = pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "communities");
  const id = idx >= 0 ? parts[idx + 1] : null;
  return id || null;
}

export async function GET(req: Request) {
  try {
    const communityId = extractCommunityIdFromUrl(req);
    if (!communityId) return NextResponse.json({ error: "Missing community id" }, { status: 400 });

    const viewerWallet = await getViewerWallet();
    const sb = supabaseAdmin();

    // 1) Load community
    const { data: comm, error: commErr } = await sb
      .from("coin_communities")
      .select("id, coin_id, dev_wallet, title, created_at")
      .eq("id", communityId)
      .maybeSingle();

    if (commErr) return NextResponse.json({ error: commErr.message }, { status: 500 });
    if (!comm) return NextResponse.json({ error: "Community not found" }, { status: 404 });

    // 2) Load coin row for header info
    const { data: coinRow, error: coinErr } = await sb
      .from("coins")
      .select("id, token_address")
      .eq("id", comm.coin_id)
      .maybeSingle();

    if (coinErr) return NextResponse.json({ error: coinErr.message }, { status: 500 });

    // 3) Determine viewerRole
    let viewerRole: "dev" | "member" | null = null;

    if (viewerWallet) {
      if (viewerWallet === comm.dev_wallet) {
        viewerRole = "dev";
      } else {
        const { data: mem, error: memErr } = await sb
          .from("community_members")
          .select("role")
          .eq("community_id", comm.id)
          .eq("member_wallet", viewerWallet)
          .maybeSingle();

        if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
        if (mem?.role === "member") viewerRole = "member";
      }
    }

    // 4) Members count
    const { count: membersCount, error: countErr } = await sb
      .from("community_members")
      .select("community_id", { count: "exact", head: true })
      .eq("community_id", comm.id);

    if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });

    // 5) Messages (only if member/dev)
    const url = new URL(req.url);
    const cursor = url.searchParams.get("cursor"); // created_at cursor (older paging)

    let messages: any[] = [];
    let nextCursor: string | null = null;

    if (viewerRole) {
      // IMPORTANT: DB column is `content` (not `text`)
      // image_url exists only if you add it via SQL (see below).
      let q = sb
        .from("community_messages")
        .select("id, community_id, author_wallet, content, image_url, created_at")
        .eq("community_id", comm.id)
        .order("created_at", { ascending: false })
        .limit(51);

      if (cursor) q = q.lt("created_at", cursor);

      const { data: rawMsgs, error: msgErr } = await q;
      if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

      const list = rawMsgs ?? [];
      const hasMore = list.length > 50;
      const page = hasMore ? list.slice(0, 50) : list;

      nextCursor = hasMore && page.length ? page[page.length - 1].created_at : null;

      // return ascending for chat UI
      const asc = [...page].reverse();

      // Enrich author info (display_name + signed pfp)
      const authorWallets = Array.from(new Set(asc.map((m: any) => m.author_wallet).filter(Boolean)));

      const { data: profs } = await sb
        .from("dev_profiles")
        .select("wallet, display_name, pfp_path")
        .in("wallet", authorWallets);

      const profByWallet = new Map<string, any>();
      for (const p of profs ?? []) profByWallet.set(p.wallet, p);

      async function signedPfpUrlFromPath(path?: string | null) {
        if (!path) return null;
        const { data, error } = await sb.storage.from("pfp").createSignedUrl(path, 60 * 30);
        if (error) return null;
        return data?.signedUrl ?? null;
      }

      const pfpUrlByWallet = new Map<string, string | null>();
      await Promise.all(
        authorWallets.map(async (w) => {
          const p = profByWallet.get(w);
          const url = await signedPfpUrlFromPath(p?.pfp_path ?? null);
          pfpUrlByWallet.set(w, url);
        })
      );

      // ✅ Map DB content -> UI text (your UI uses m.text)
      messages = asc.map((m: any) => {
        const p = profByWallet.get(m.author_wallet);
        return {
          id: m.id,
          community_id: m.community_id,
          author_wallet: m.author_wallet,
          author_name: p?.display_name ?? null,
          author_pfp_url: pfpUrlByWallet.get(m.author_wallet) ?? null,
          text: m.content ?? null,
          image_url: m.image_url ?? null,
          created_at: m.created_at
        };
      });
    }

    const coin = coinRow
      ? {
          id: coinRow.id,
          token_address: coinRow.token_address,
          name: null,
          symbol: null,
          image: null
        }
      : null;

    return NextResponse.json({
      ok: true,
      community: {
        ...comm,
        viewerRole,
        membersCount: membersCount ?? 0
      },
      coin,
      messages,
      nextCursor
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load community", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
