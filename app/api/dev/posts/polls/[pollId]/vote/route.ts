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
  ctx: { params: Promise<{ pollId: string }> }
) {
  try {
    const { pollId } = await ctx.params;

    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const trialBlock = await requireFullAccess();
    if (trialBlock) return trialBlock;

    const body = await req.json().catch(() => null);
    const option_id =
      typeof body?.option_id === "string" ? body.option_id.trim() : "";

    if (!option_id) {
      return NextResponse.json({ error: "option_id required" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    const { data: poll, error: pollErr } = await sb
      .from("dev_post_polls")
      .select("id")
      .eq("id", pollId)
      .maybeSingle();

    if (pollErr) {
      return NextResponse.json({ error: pollErr.message }, { status: 500 });
    }

    if (!poll) {
      return NextResponse.json({ error: "Poll not found" }, { status: 404 });
    }

    const { data: option, error: optErr } = await sb
      .from("dev_post_poll_options")
      .select("id, poll_id")
      .eq("id", option_id)
      .maybeSingle();

    if (optErr) {
      return NextResponse.json({ error: optErr.message }, { status: 500 });
    }

    if (!option || option.poll_id !== pollId) {
      return NextResponse.json({ error: "Invalid poll option" }, { status: 400 });
    }

    const { error: voteErr } = await sb
      .from("dev_post_poll_votes")
      .upsert(
        {
          poll_id: pollId,
          option_id,
          voter_wallet: viewerWallet
        },
        { onConflict: "poll_id,voter_wallet" }
      );

    if (voteErr) {
      return NextResponse.json({ error: voteErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      poll_id: pollId,
      option_id
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to vote", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
