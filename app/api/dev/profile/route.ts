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

/**
 * FIX:
 * Dev detection must match how your app actually works.
 * A wallet is a dev if:
 *  - it has a row in dev_profiles (most reliable for your UI), OR
 *  - users.role is dev/admin (keeps role support)
 */
async function requireDev(wallet: string) {
  const sb = supabaseAdmin();

  // 1) If they have a dev_profile, they are a dev (this fixes the Account tab issue).
  const prof = await sb.from("dev_profiles").select("wallet").eq("wallet", wallet).maybeSingle();
  if (!prof.error && prof.data?.wallet) return true;

  // 2) Fallback to users.role if you still use roles
  const u = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle();
  const role = (u.data?.role ?? null) as string | null;
  return role === "dev" || role === "admin";
}

// Try a couple bucket names so you don’t break if bucket differs between envs
const DEV_POST_BUCKETS = ["dev-posts", "dev_posts", "posts", "devposts"];

async function signedDevPostImageUrl(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;

  for (const bucket of DEV_POST_BUCKETS) {
    try {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 60 * 30);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      // try next bucket
    }
  }

  return null;
}

export async function GET() {
  const session = await requireWallet();
  if (!session?.wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!(await requireDev(session.wallet))) {
    return NextResponse.json({ error: "Not a dev" }, { status: 403 });
  }

  const sb = supabaseAdmin();

  const profileRes = await sb.from("dev_profiles").select("*").eq("wallet", session.wallet).maybeSingle();
  const coinsRes = await sb
    .from("coins")
    .select("*")
    .eq("wallet", session.wallet)
    .order("created_at", { ascending: false });

  // include image_path (and any other fields you already store)
  const postsRes = await sb
    .from("dev_posts")
    .select("*")
    .eq("wallet", session.wallet)
    .order("created_at", { ascending: false });

  if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  if (coinsRes.error) return NextResponse.json({ error: coinsRes.error.message }, { status: 500 });
  if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });

  const postsRaw = postsRes.data ?? [];
  const posts = await Promise.all(
    postsRaw.map(async (p: any) => ({
      ...p,
      image_url: await signedDevPostImageUrl(sb, p.image_path ?? null)
    }))
  );

  return NextResponse.json({
    ok: true,
    profile: profileRes.data ?? null,
    coins: coinsRes.data ?? [],
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
