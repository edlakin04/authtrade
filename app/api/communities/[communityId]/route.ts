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
  const { pathname } = new URL(req.url);
  const parts = pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "communities");
  const id = idx >= 0 ? parts[idx + 1] : null;
  return id || null;
}

export async function GET(req: Request) {
  try {
    const communityId = extractCommunityIdFromUrl(req);
    if (!communityId)
      return NextResponse.json({ error: "Missing community id" }, { status: 400 });

    const viewerWallet = await getViewerWallet();
    const sb = supabaseAdmin();

    const { data: comm, error: commErr } = await sb
      .from("coin_communities")
      .select("id, coin_id, dev_wallet, title, created_at, pinned_message_id")
      .eq("id", communityId)
      .maybeSingle();

    if (commErr)
      return NextResponse.json({ error: commErr.message }, { status: 500 });

    if (!comm)
      return NextResponse.json({ error: "Community not found" }, { status: 404 });

    const { data: coinRow } = await sb
      .from("coins")
      .select("id, token_address")
      .eq("id", comm.coin_id)
      .maybeSingle();

    let viewerRole: "dev" | "member" | null = null;

    if (viewerWallet) {
      if (viewerWallet === comm.dev_wallet) viewerRole = "dev";
      else {
        const { data: mem } = await sb
          .from("community_members")
          .select("role")
          .eq("community_id", comm.id)
          .eq("member_wallet", viewerWallet)
          .maybeSingle();

        if (mem?.role === "member") viewerRole = "member";
      }
    }

    const { count: membersCount } = await sb
      .from("community_members")
      .select("community_id", { count: "exact", head: true })
      .eq("community_id", comm.id);

    const url = new URL(req.url);
    const cursor = url.searchParams.get("cursor");

    let messages: any[] = [];
    let nextCursor: string | null = null;

    async function signedUserPfp(path?: string | null) {
      if (!path) return null;
      const { data } = await sb.storage.from("userpfp").createSignedUrl(path, 60 * 30);
      return data?.signedUrl ?? null;
    }

    async function signedDevPfp(path?: string | null) {
      if (!path) return null;
      const { data } = await sb.storage.from("pfp").createSignedUrl(path, 60 * 30);
      return data?.signedUrl ?? null;
    }

    async function signedCommunityImage(path?: string | null) {
      if (!path) return null;
      const { data } = await sb.storage.from("community").createSignedUrl(path, 60 * 30);
      return data?.signedUrl ?? null;
    }

    if (viewerRole) {
      let q = sb
        .from("community_messages")
        .select("id, community_id, author_wallet, content, image_path, poll_id, created_at")
        .eq("community_id", comm.id)
        .order("created_at", { ascending: false })
        .limit(51);

      if (cursor) q = q.lt("created_at", cursor);

      const { data: rawMsgs } = await q;

      const list = rawMsgs ?? [];
      const hasMore = list.length > 50;
      const page = hasMore ? list.slice(0, 50) : list;

      nextCursor = hasMore && page.length ? page[page.length - 1].created_at : null;

      const asc = [...page].reverse();

      const authorWallets = Array.from(
        new Set(asc.map((m: any) => m.author_wallet).filter(Boolean))
      );

      const { data: userProfs } = await sb
        .from("user_profiles")
        .select("wallet, display_name, pfp_path")
        .in("wallet", authorWallets);

      const userByWallet = new Map<string, any>();
      for (const p of userProfs ?? []) userByWallet.set(p.wallet, p);

      const { data: devProfs } = await sb
        .from("dev_profiles")
        .select("wallet, display_name, pfp_path")
        .in("wallet", authorWallets);

      const devByWallet = new Map<string, any>();
      for (const p of devProfs ?? []) devByWallet.set(p.wallet, p);

      const avatarByWallet = new Map<string, string | null>();

      await Promise.all(
        authorWallets.map(async (w) => {
          const up = userByWallet.get(w);
          if (up?.pfp_path) {
            avatarByWallet.set(w, await signedUserPfp(up.pfp_path));
            return;
          }

          const dp = devByWallet.get(w);
          avatarByWallet.set(w, await signedDevPfp(dp?.pfp_path ?? null));
        })
      );

      const imageUrlByMessageId = new Map<string, string | null>();

      await Promise.all(
        asc.map(async (m: any) => {
          imageUrlByMessageId.set(m.id, await signedCommunityImage(m.image_path));
        })
      );

      /* ---------------- POLL DATA ---------------- */

      const pollIds = asc.map((m: any) => m.poll_id).filter(Boolean);

      const pollMap = new Map();

      if (pollIds.length) {
        const { data: polls } = await sb
          .from("community_polls")
          .select("id, question")
          .in("id", pollIds);

        const { data: options } = await sb
          .from("community_poll_options")
          .select("id, poll_id, label, sort_order")
          .in("poll_id", pollIds);

        const { data: votes } = await sb
          .from("community_poll_votes")
          .select("poll_id, option_id, voter_wallet")
          .in("poll_id", pollIds);

        for (const p of polls ?? []) {
          pollMap.set(p.id, {
            id: p.id,
            question: p.question,
            options: []
          });
        }

        for (const o of options ?? []) {
          const p = pollMap.get(o.poll_id);
          if (!p) continue;

          p.options.push({
            id: o.id,
            label: o.label,
            votes: 0
          });
        }

        for (const v of votes ?? []) {
          const p = pollMap.get(v.poll_id);
          if (!p) continue;

          const opt = p.options.find((x: any) => x.id === v.option_id);
          if (opt) opt.votes++;

          if (v.voter_wallet === viewerWallet) {
            p.viewer_vote = v.option_id;
          }
        }
      }

      /* ------------------------------------------- */

      messages = asc.map((m: any) => {
        const up = userByWallet.get(m.author_wallet);
        const dp = devByWallet.get(m.author_wallet);

        const author_name =
          up?.display_name || dp?.display_name || null;

        const is_dev = m.author_wallet === comm.dev_wallet;

        return {
          id: m.id,
          community_id: m.community_id,
          author_wallet: m.author_wallet,
          author_name,
          author_pfp_url: avatarByWallet.get(m.author_wallet) ?? null,
          is_dev,
          text: m.content ?? null,
          image_url: imageUrlByMessageId.get(m.id) ?? null,
          poll: m.poll_id ? pollMap.get(m.poll_id) ?? null : null,
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

    // Hydrate pinned message if one is set
    let pinnedMessage: any = null;
    const pinnedMessageId = (comm as any).pinned_message_id ?? null;

    if (pinnedMessageId) {
      // Check if it's already in the current message page
      const found = messages.find((m: any) => m.id === pinnedMessageId) ?? null;

      if (found) {
        pinnedMessage = found;
      } else {
        // Fetch it separately — it may be outside the current page
        const { data: pinnedRaw } = await sb
          .from("community_messages")
          .select("id, community_id, author_wallet, content, image_path, poll_id, created_at")
          .eq("id", pinnedMessageId)
          .maybeSingle();

        if (pinnedRaw) {
          const up = await sb
            .from("user_profiles")
            .select("wallet, display_name, pfp_path")
            .eq("wallet", pinnedRaw.author_wallet)
            .maybeSingle();

          const dp = await sb
            .from("dev_profiles")
            .select("wallet, display_name, pfp_path")
            .eq("wallet", pinnedRaw.author_wallet)
            .maybeSingle();

          const authorName = up.data?.display_name || dp.data?.display_name || null;
          const isDev = pinnedRaw.author_wallet === comm.dev_wallet;

          let avatarUrl: string | null = null;
          if (up.data?.pfp_path) {
            const { data: su } = await sb.storage.from("userpfp").createSignedUrl(up.data.pfp_path, 60 * 30);
            avatarUrl = su?.signedUrl ?? null;
          } else if (dp.data?.pfp_path) {
            const { data: sd } = await sb.storage.from("pfp").createSignedUrl(dp.data.pfp_path, 60 * 30);
            avatarUrl = sd?.signedUrl ?? null;
          }

          let imageUrl: string | null = null;
          if (pinnedRaw.image_path) {
            const { data: si } = await sb.storage.from("community").createSignedUrl(pinnedRaw.image_path, 60 * 30);
            imageUrl = si?.signedUrl ?? null;
          }

          pinnedMessage = {
            id: pinnedRaw.id,
            community_id: pinnedRaw.community_id,
            author_wallet: pinnedRaw.author_wallet,
            author_name: authorName,
            author_pfp_url: avatarUrl,
            is_dev: isDev,
            text: pinnedRaw.content ?? null,
            image_url: imageUrl,
            poll: null,
            created_at: pinnedRaw.created_at
          };
        }
      }
    }

    return NextResponse.json({
      ok: true,
      community: {
        ...comm,
        viewerRole,
        membersCount: membersCount ?? 0
      },
      coin,
      messages,
      nextCursor,
      pinnedMessage
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load community", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
