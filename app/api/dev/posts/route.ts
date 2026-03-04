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

async function requireDev(wallet: string) {
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("users")
    .select("role")
    .eq("wallet", wallet)
    .maybeSingle();

  return data?.role === "dev" || data?.role === "admin";
}

export async function POST(req: Request) {
  try {
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    if (!(await requireDev(viewerWallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);

    const content =
      typeof body?.content === "string" ? body.content.trim() : "";

    const image_path =
      typeof body?.image_path === "string" ? body.image_path.trim() : null;

    const pollQuestion =
      typeof body?.poll_question === "string"
        ? body.poll_question.trim()
        : null;

    const pollOptionsRaw = Array.isArray(body?.poll_options)
      ? body.poll_options
      : [];

    const pollOptions = pollOptionsRaw
      .map((o: any) => (typeof o === "string" ? o.trim() : ""))
      .filter(Boolean)
      .slice(0, 6);

    const sb = supabaseAdmin();

    let pollId: string | null = null;

    /* ---------------- CREATE POLL ---------------- */

    if (pollQuestion && pollOptions.length >= 2) {
      const { data: poll, error: pollErr } = await sb
        .from("dev_post_polls")
        .insert({
          dev_wallet: viewerWallet,
          question: pollQuestion
        })
        .select("id")
        .single();

      if (pollErr) {
        return NextResponse.json({ error: pollErr.message }, { status: 500 });
      }

      pollId = poll.id;

      const optionRows = pollOptions.map((label: string, i: number) => ({
        poll_id: pollId,
        label,
        sort_order: i
      }));

      const { error: optErr } = await sb
        .from("dev_post_poll_options")
        .insert(optionRows);

      if (optErr) {
        return NextResponse.json({ error: optErr.message }, { status: 500 });
      }
    }

    /* ---------------- CREATE POST ---------------- */

    const { data: post, error: postErr } = await sb
      .from("dev_posts")
      .insert({
        wallet: viewerWallet,
        content: content || pollQuestion || null,
        image_path,
        poll_id: pollId
      })
      .select("*")
      .single();

    if (postErr) {
      return NextResponse.json({ error: postErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      post
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to create post", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
