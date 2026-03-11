import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireFullAccess } from "@/lib/subscription";
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

export async function POST(
  req: Request,
  ctx: { params: Promise<{ communityId: string }> }
) {
  try {
    const { communityId } = await ctx.params;

    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const trialBlock = await requireFullAccess();
    if (trialBlock) return trialBlock;

    const body = await req.json().catch(() => null);

    const question =
      typeof body?.question === "string" ? body.question.trim() : "";
    const optionsRaw = Array.isArray(body?.options) ? body.options : [];
    const options = optionsRaw
      .map((o: any) => (typeof o === "string" ? o.trim() : ""))
      .filter(Boolean)
      .slice(0, 6);

    if (!question) {
      return NextResponse.json(
        { error: "Poll question required" },
        { status: 400 }
      );
    }

    if (options.length < 2) {
      return NextResponse.json(
        { error: "At least 2 poll options required" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    const { data: community, error: commErr } = await sb
      .from("coin_communities")
      .select("id, dev_wallet")
      .eq("id", communityId)
      .maybeSingle();

    if (commErr) {
      return NextResponse.json({ error: commErr.message }, { status: 500 });
    }

    if (!community) {
      return NextResponse.json(
        { error: "Community not found" },
        { status: 404 }
      );
    }

    if (community.dev_wallet !== viewerWallet) {
      return NextResponse.json(
        { error: "Only the dev can create polls" },
        { status: 403 }
      );
    }

    const { data: poll, error: pollErr } = await sb
      .from("community_polls")
      .insert({
        community_id: communityId,
        dev_wallet: viewerWallet,
        question
      })
      .select("id")
      .single();

    if (pollErr) {
      return NextResponse.json({ error: pollErr.message }, { status: 500 });
    }

    const optionRows = options.map((label: string, i: number) => ({
      poll_id: poll.id,
      label,
      sort_order: i
    }));

    const { error: optionsErr } = await sb
      .from("community_poll_options")
      .insert(optionRows);

    if (optionsErr) {
      return NextResponse.json({ error: optionsErr.message }, { status: 500 });
    }

    const { data: message, error: msgErr } = await sb
      .from("community_messages")
      .insert({
        community_id: communityId,
        author_wallet: viewerWallet,
        content: question,
        image_path: null,
        poll_id: poll.id
      })
      .select("id")
      .single();

    if (msgErr) {
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      poll_id: poll.id,
      message_id: message.id
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to create poll", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
