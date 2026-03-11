import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { requireFullAccess } from "@/lib/subscription";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function clampRating(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(1, Math.min(5, Math.floor(n)));
}

async function getViewerWallet(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return null;
  const session = await readSessionToken(sessionToken).catch(() => null);
  return session?.wallet ?? null;
}

async function ensureUser(sb: ReturnType<typeof supabaseAdmin>, wallet: string) {
  await sb.from("users").upsert({ wallet }, { onConflict: "wallet" });
  await sb.from("user_profiles").upsert({ wallet }, { onConflict: "wallet" });
}

async function signedUserPfp(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;
  const { data, error } = await sb.storage.from("userpfp").createSignedUrl(path, 60 * 30);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const sb = supabaseAdmin();

  const { wallet: devWallet } = await ctx.params;
  const dev_wallet = decodeURIComponent(devWallet || "").trim();
  if (!dev_wallet) return NextResponse.json({ error: "Missing dev wallet" }, { status: 400 });

  const { data: reviews, error } = await sb
    .from("dev_reviews")
    .select("id, dev_wallet, reviewer_wallet, rating, comment, created_at, updated_at")
    .eq("dev_wallet", dev_wallet)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = reviews ?? [];
  const wallets = Array.from(new Set(rows.map((r) => r.reviewer_wallet).filter(Boolean)));

  const { data: profs } = await sb
    .from("user_profiles")
    .select("wallet, display_name, pfp_path")
    .in("wallet", wallets);

  const profByWallet = new Map<string, any>();
  for (const p of profs ?? []) profByWallet.set(p.wallet, p);

  const pfpUrlByWallet = new Map<string, string | null>();
  await Promise.all(
    wallets.map(async (w) => {
      const p = profByWallet.get(w);
      const url = await signedUserPfp(sb, p?.pfp_path ?? null);
      pfpUrlByWallet.set(w, url);
    })
  );

  const count = rows.length;
  const avg = count > 0 ? rows.reduce((s, r) => s + (Number(r.rating) || 0), 0) / count : null;

  return NextResponse.json({
    ok: true,
    dev_wallet,
    count,
    avgRating: avg ? Number(avg.toFixed(2)) : null,
    reviews: rows.map((r) => {
      const p = profByWallet.get(r.reviewer_wallet);
      return {
        ...r,
        reviewer_name: (p?.display_name ?? null) as string | null,
        reviewer_pfp_url: (pfpUrlByWallet.get(r.reviewer_wallet) ?? null) as string | null
      };
    })
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const sb = supabaseAdmin();

  const viewerWallet = await getViewerWallet();
  if (!viewerWallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const trialBlock = await requireFullAccess();
  if (trialBlock) return trialBlock;

  const { wallet: devWallet } = await ctx.params;
  const dev_wallet = decodeURIComponent(devWallet || "").trim();
  if (!dev_wallet) return NextResponse.json({ error: "Missing dev wallet" }, { status: 400 });

  if (dev_wallet === viewerWallet) {
    return NextResponse.json({ error: "You can’t review yourself." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const rating = clampRating(Number(body?.rating));
  const commentRaw = typeof body?.comment === "string" ? body.comment : "";
  const comment = commentRaw.trim().slice(0, 2000) || null;

  if (!rating) return NextResponse.json({ error: "Invalid rating" }, { status: 400 });

  await ensureUser(sb, viewerWallet);
  await ensureUser(sb, dev_wallet);

  const { error } = await sb
    .from("dev_reviews")
    .upsert(
      {
        dev_wallet,
        reviewer_wallet: viewerWallet,
        rating,
        comment
      },
      { onConflict: "dev_wallet,reviewer_wallet" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
