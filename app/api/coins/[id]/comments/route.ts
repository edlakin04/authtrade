import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function safeReadJson(req: Request): Promise<any | null> {
  try {
    return await req.json();
  } catch {
    try {
      const txt = await req.text();
      if (!txt) return null;
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }
}

async function signedUserPfp(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;
  const { data, error } = await sb.storage.from("userpfp").createSignedUrl(path, 60 * 30);
  if (error) return null;
  return data?.signedUrl ?? null;
}

async function signedDevPfp(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;
  const { data, error } = await sb.storage.from("pfp").createSignedUrl(path, 60 * 30);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = supabaseAdmin();

  // Grab coin owner dev wallet for DEV badge
  const coinRes = await sb
    .from("coins")
    .select("dev_wallet, wallet")
    .eq("id", id)
    .maybeSingle();

  if (coinRes.error) return NextResponse.json({ error: coinRes.error.message }, { status: 500 });

  const coinDevWallet =
    (coinRes.data as any)?.dev_wallet || (coinRes.data as any)?.wallet || null;

  const { data, error } = await sb
    .from("coin_comments")
    .select("id, coin_id, author_wallet, comment, created_at")
    .eq("coin_id", id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const wallets = Array.from(new Set(rows.map((r) => r.author_wallet).filter(Boolean)));

  // Prefer user_profiles
  const { data: userProfs } = await sb
    .from("user_profiles")
    .select("wallet, display_name, pfp_path")
    .in("wallet", wallets);

  const userByWallet = new Map<string, any>();
  for (const p of userProfs ?? []) userByWallet.set(p.wallet, p);

  // Fallback: dev_profiles
  const { data: devProfs } = await sb
    .from("dev_profiles")
    .select("wallet, display_name, pfp_path")
    .in("wallet", wallets);

  const devByWallet = new Map<string, any>();
  for (const p of devProfs ?? []) devByWallet.set(p.wallet, p);

  // Pre-sign avatars (user bucket first, fallback dev bucket)
  const pfpUrlByWallet = new Map<string, string | null>();
  await Promise.all(
    wallets.map(async (w) => {
      const up = userByWallet.get(w);
      if (up?.pfp_path) {
        pfpUrlByWallet.set(w, await signedUserPfp(sb, up.pfp_path));
        return;
      }
      const dp = devByWallet.get(w);
      pfpUrlByWallet.set(w, await signedDevPfp(sb, dp?.pfp_path ?? null));
    })
  );

  return NextResponse.json({
    ok: true,
    coinDevWallet,
    comments: rows.map((r) => {
      const up = userByWallet.get(r.author_wallet);
      const dp = devByWallet.get(r.author_wallet);

      const author_name =
        (typeof up?.display_name === "string" && up.display_name) ||
        (typeof dp?.display_name === "string" && dp.display_name) ||
        null;

      const is_dev = !!coinDevWallet && r.author_wallet === coinDevWallet;

      return {
        id: r.id,
        coin_id: r.coin_id,
        author_wallet: r.author_wallet,
        author_name,
        author_pfp_url: (pfpUrlByWallet.get(r.author_wallet) ?? null) as string | null,
        is_dev,
        comment: r.comment,
        created_at: r.created_at
      };
    })
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const session = await readSessionToken(sessionToken).catch(() => null);
  if (!session?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const body = await safeReadJson(req);

  const raw =
    (typeof body?.comment === "string" && body.comment) ||
    (typeof body?.content === "string" && body.content) ||
    (typeof body?.text === "string" && body.text) ||
    "";

  const comment = raw.trim();
  if (!comment) return NextResponse.json({ error: "Comment is empty" }, { status: 400 });

  if (comment.length > 2000) {
    return NextResponse.json({ error: "Comment too long (max 2000 chars)" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // ensure users row exists
  await sb.from("users").upsert({ wallet: session.wallet }, { onConflict: "wallet" });
  // optional: ensure profile row exists (so they can later set name/pfp)
  await sb.from("user_profiles").upsert({ wallet: session.wallet }, { onConflict: "wallet" });

  const { error } = await sb.from("coin_comments").insert({
    coin_id: id,
    author_wallet: session.wallet,
    comment
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
