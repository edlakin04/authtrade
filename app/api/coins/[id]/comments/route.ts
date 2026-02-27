import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

async function getViewerWallet(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  const session = await readSessionToken(sessionToken).catch(() => null);
  return session?.wallet ?? null;
}

async function ensureUser(sb: ReturnType<typeof supabaseAdmin>, wallet: string) {
  await sb.from("users").upsert({ wallet }, { onConflict: "wallet" });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = supabaseAdmin();

  const { id } = await ctx.params;
  const coin_id = decodeURIComponent(id || "").trim();
  if (!coin_id) return NextResponse.json({ error: "Missing coin id" }, { status: 400 });

  const { data, error } = await sb
    .from("coin_comments")
    .select("id, coin_id, author_wallet, comment, created_at")
    .eq("coin_id", coin_id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, coin_id, comments: data ?? [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = supabaseAdmin();
  const viewerWallet = await getViewerWallet();
  if (!viewerWallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const coin_id = decodeURIComponent(id || "").trim();
  if (!coin_id) return NextResponse.json({ error: "Missing coin id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const commentRaw = typeof body?.comment === "string" ? body.comment : "";
  const comment = commentRaw.trim().slice(0, 2000);

  if (!comment) return NextResponse.json({ error: "Comment is empty" }, { status: 400 });

  await ensureUser(sb, viewerWallet);

  const { error } = await sb.from("coin_comments").insert({
    coin_id,
    author_wallet: viewerWallet,
    comment
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
