// app/api/dev/coins/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createNotificationsForFollowers } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BANNER_BYTES = 15 * 1024 * 1024; // 15MB
const ALLOWED_BANNER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const COIN_BANNER_BUCKET = "coin-banners";

function looksLikeSolAddress(s: string) {
  return s.length >= 32 && s.length <= 50;
}

function safeTrim(v: any): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function extFromType(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "bin";
}

async function requireDev(wallet: string) {
  const sb = supabaseAdmin();

  // 1) dev_profiles row = dev (matches your UI behavior)
  const prof = await sb.from("dev_profiles").select("wallet").eq("wallet", wallet).maybeSingle();
  if (!prof.error && prof.data?.wallet) return true;

  // 2) fallback: users.role
  const { data: user } = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle();
  const role = (user?.role ?? null) as string | null;
  return role === "dev" || role === "admin";
}

async function signCoinBannerUrl(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;
  const { data, error } = await sb.storage.from(COIN_BANNER_BUCKET).createSignedUrl(path, 60 * 30);
  if (error) return null;
  return data?.signedUrl ?? null;
}

async function uploadCoinBanner(sb: ReturnType<typeof supabaseAdmin>, wallet: string, coinId: string, file: File) {
  if (!ALLOWED_BANNER_TYPES.has(file.type)) {
    throw new Error("Invalid banner file type. Allowed: jpeg, png, webp.");
  }

  if (file.size <= 0) {
    throw new Error("Empty banner file.");
  }

  if (file.size > MAX_BANNER_BYTES) {
    throw new Error("Banner file too large (max 15MB).");
  }

  const ext = extFromType(file.type);
  // Stable path per coin (overwrite allowed)
  const path = `coins/${wallet}/${coinId}/banner.${ext}`;

  // ✅ IMPORTANT: use Buffer like your working pfp route
  const buf = Buffer.from(await file.arrayBuffer());

  const { error } = await sb.storage.from(COIN_BANNER_BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: true
  });

  if (error) throw new Error(error.message);
  return path;
}

function pickBannerFile(fd: FormData): File | null {
  // ✅ accept multiple possible keys (so UI can evolve without breaking backend)
  const keys = ["file", "banner", "banner_file"];
  for (const k of keys) {
    const v = fd.get(k);
    if (v && v instanceof File) return v;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const session = await readSessionToken(sessionToken).catch(() => null);
    if (!session?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    if (!(await requireDev(session.wallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const sb = supabaseAdmin();
    const ct = req.headers.get("content-type") || "";

    let token_address: string | null = null;
    let title: string | null = null;
    let description: string | null = null;
    let bannerFile: File | null = null;

    // ✅ Support BOTH FormData (banner) and JSON (no banner)
    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();

      token_address = safeTrim(fd.get("token_address"));
      title = safeTrim(fd.get("title"));
      description = safeTrim(fd.get("description"));

      bannerFile = pickBannerFile(fd);
    } else {
      const body = await req.json().catch(() => null);

      token_address = typeof body?.token_address === "string" ? body.token_address.trim() : null;
      title = typeof body?.title === "string" ? body.title.trim() || null : null;
      description = typeof body?.description === "string" ? body.description.trim() || null : null;
      // no file in JSON mode
    }

    if (!token_address || !looksLikeSolAddress(token_address)) {
      return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
    }

    // 1) Create coin row first
    const { data: coin, error: insertErr } = await sb
      .from("coins")
      .insert({
        wallet: session.wallet,
        token_address,
        title,
        description
      })
      .select("id, wallet, token_address, title, description, created_at, banner_path")
      .single();

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    let banner_path: string | null = coin?.banner_path ?? null;

    // 2) If banner file provided, upload + update banner_path
    if (bannerFile) {
      try {
        banner_path = await uploadCoinBanner(sb, session.wallet, String(coin.id), bannerFile);

        const { error: upErr } = await sb.from("coins").update({ banner_path }).eq("id", coin.id);

        if (upErr) {
          return NextResponse.json({ error: upErr.message }, { status: 500 });
        }
      } catch (e: any) {
        return NextResponse.json(
          {
            error: "Coin created but banner upload failed",
            details: e?.message ?? String(e),
            coin
          },
          { status: 400 }
        );
      }
    }

    const banner_url = await signCoinBannerUrl(sb, banner_path);

    // ── Notify followers ──────────────────────────────────────────────
    await createNotificationsForFollowers({
      actorWallet: session.wallet,
      type: "new_coin",
      title: "listed a new coin",
      body: title ?? token_address ?? null,
      link: `/coin/${encodeURIComponent(String(coin.id))}`,
    });
    // ─────────────────────────────────────────────────────────────────

    return NextResponse.json({
      ok: true,
      coin: {
        ...coin,
        banner_path,
        banner_url
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Failed to add coin", details: e?.message ?? String(e) }, { status: 500 });
  }
}

/**
 * Coins are permanent and cannot be removed individually.
 * They are only removed when the dev deletes their whole profile.
 */
export async function DELETE() {
  return NextResponse.json(
    { error: "Coin removal is disabled. Delete your profile to remove your coins." },
    { status: 405 }
  );
}
