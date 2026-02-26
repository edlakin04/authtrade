import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const session = await readSessionToken(sessionToken).catch(() => null);
  if (!session?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const sb = supabaseAdmin();
  const { data: user } = await sb.from("users").select("role").eq("wallet", session.wallet).maybeSingle();
  if (user?.role !== "dev" && user?.role !== "admin") return NextResponse.json({ error: "Not a dev" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const content = (body?.content as string | undefined)?.trim();

  if (!content || content.length < 2) return NextResponse.json({ error: "Post too short" }, { status: 400 });
  if (content.length > 500) return NextResponse.json({ error: "Post too long (max 500)" }, { status: 400 });

  const { error } = await sb.from("dev_posts").insert({ wallet: session.wallet, content });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
