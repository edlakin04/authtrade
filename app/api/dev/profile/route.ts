import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

async function requireWallet() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  return await readSessionToken(sessionToken).catch(() => null);
}

async function requireDev(wallet: string) {
  const sb = supabaseAdmin();
  const { data } = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle();
  return data?.role === "dev" || data?.role === "admin";
}

async function signedDevPostImageUrl(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;
  const { data } = await sb.storage.from("dev-posts").createSignedUrl(path, 60 * 30);
  return data?.signedUrl ?? null;
}

export async function GET() {
  const session = await requireWallet();
  if (!session?.wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!(await requireDev(session.wallet))) {
    return NextResponse.json({ error: "Not a dev" }, { status: 403 });
  }

  const sb = supabaseAdmin();

  const profile = await sb.from("dev_profiles").select("*").eq("wallet", session.wallet).maybeSingle();

  const coins = await sb
    .from("coins")
    .select("*")
    .eq("wallet", session.wallet)
    .order("created_at", { ascending: false });

  const postsRes = await sb
    .from("dev_posts")
    .select("*")
    .eq("wallet", session.wallet)
    .order("created_at", { ascending: false });

  if (profile.error) return NextResponse.json({ error: profile.error.message }, { status: 500 });
  if (coins.error) return NextResponse.json({ error: coins.error.message }, { status: 500 });
  if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });

  const postsRaw = postsRes.data ?? [];

  const pollIds = postsRaw.map((p: any) => p.poll_id).filter(Boolean);

  let pollMap = new Map();

  if (pollIds.length) {
    const { data: polls } = await sb
      .from("dev_post_polls")
      .select("id, question")
      .in("id", pollIds);

    const { data: options } = await sb
      .from("dev_post_poll_options")
      .select("id, poll_id, label, sort_order")
      .in("poll_id", pollIds);

    const { data: votes } = await sb
      .from("dev_post_poll_votes")
      .select("poll_id, option_id");

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
    }
  }

  const posts = await Promise.all(
    postsRaw.map(async (p: any) => ({
      ...p,
      image_url: await signedDevPostImageUrl(sb, p.image_path ?? null),
      poll: p.poll_id ? pollMap.get(p.poll_id) ?? null : null
    }))
  );

  return NextResponse.json({
    ok: true,
    profile: profile.data ?? null,
    coins: coins.data ?? [],
    posts
  });
}

export async function PUT(req: Request) {
  const session = await requireWallet();
  if (!session?.wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!(await requireDev(session.wallet))) {
    return NextResponse.json({ error: "Not a dev" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  const display_name = (body?.display_name as string | undefined)?.trim();
  const bio = (body?.bio as string | undefined)?.trim() ?? null;
  const pfp_url = (body?.pfp_url as string | undefined)?.trim() ?? null;
  const x_url = (body?.x_url as string | undefined)?.trim() ?? null;

  if (!display_name) {
    return NextResponse.json({ error: "Display name required" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { error } = await sb.from("dev_profiles").upsert({
    wallet: session.wallet,
    display_name,
    bio,
    pfp_url,
    x_url,
    updated_at: new Date().toISOString()
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await requireWallet();
  if (!session?.wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!(await requireDev(session.wallet))) {
    return NextResponse.json({ error: "Not a dev" }, { status: 403 });
  }

  const sb = supabaseAdmin();

  await sb.from("coins").delete().eq("wallet", session.wallet);
  await sb.from("dev_posts").delete().eq("wallet", session.wallet);
  await sb.from("dev_profiles").delete().eq("wallet", session.wallet);

  return NextResponse.json({ ok: true });
}
