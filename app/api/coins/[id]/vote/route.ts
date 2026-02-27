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

async function countVotes(sb: ReturnType<typeof supabaseAdmin>, coin_id: string) {
  const { count, error } = await sb
    .from("coin_votes")
    .select("*", { count: "exact", head: true })
    .eq("coin_id", coin_id);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = supabaseAdmin();
  const viewerWallet = await getViewerWallet();

  const { id } = await ctx.params;
  const coin_id = decodeURIComponent(id || "").trim();
  if (!coin_id) return NextResponse.json({ error: "Missing coin id" }, { status: 400 });

  const votes = await countVotes(sb, coin_id);

  let voted = false;
  if (viewerWallet) {
    const { data } = await sb
      .from("coin_votes")
      .select("coin_id")
      .eq("coin_id", coin_id)
      .eq("voter_wallet", viewerWallet)
      .maybeSingle();

    voted = !!data;
  }

  return NextResponse.json({ ok: true, coin_id, votes, voted });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = supabaseAdmin();
  const viewerWallet = await getViewerWallet();
  if (!viewerWallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const coin_id = decodeURIComponent(id || "").trim();
  if (!coin_id) return NextResponse.json({ error: "Missing coin id" }, { status: 400 });

  await ensureUser(sb, viewerWallet);

  // toggle vote: if exists → delete, else → insert
  const { data: existing, error: readErr } = await sb
    .from("coin_votes")
    .select("coin_id")
    .eq("coin_id", coin_id)
    .eq("voter_wallet", viewerWallet)
    .maybeSingle();

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  if (existing) {
    const { error: delErr } = await sb
      .from("coin_votes")
      .delete()
      .eq("coin_id", coin_id)
      .eq("voter_wallet", viewerWallet);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  } else {
    const { error: insErr } = await sb.from("coin_votes").insert({
      coin_id,
      voter_wallet: viewerWallet
    });

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const votes = await countVotes(sb, coin_id);
  const voted = !existing;

  return NextResponse.json({ ok: true, coin_id, votes, voted });
}
