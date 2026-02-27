import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function safeReadJson(req: Request): Promise<any | null> {
  try {
    // Normal path
    return await req.json();
  } catch {
    // Fallback: try text -> JSON
    try {
      const txt = await req.text();
      if (!txt) return null;
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("coin_comments")
    .select("id, coin_id, commenter_wallet, content, created_at")
    .eq("coin_id", id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, comments: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const session = await readSessionToken(sessionToken).catch(() => null);
  if (!session?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const body = await safeReadJson(req);

  // accept multiple keys to avoid mismatches
  const raw =
    (typeof body?.content === "string" && body.content) ||
    (typeof body?.comment === "string" && body.comment) ||
    (typeof body?.text === "string" && body.text) ||
    "";

  const content = raw.trim();

  if (!content) {
    return NextResponse.json({ error: "Comment is empty" }, { status: 400 });
  }
  if (content.length < 2) {
    return NextResponse.json({ error: "Comment too short" }, { status: 400 });
  }
  if (content.length > 500) {
    return NextResponse.json({ error: "Comment too long (max 500 chars)" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // ensure user row exists
  await sb.from("users").upsert({ wallet: session.wallet }, { onConflict: "wallet" });

  const { error } = await sb.from("coin_comments").insert({
    coin_id: id,
    commenter_wallet: session.wallet,
    content
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
