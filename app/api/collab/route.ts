import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BANNER_BYTES = 15 * 1024 * 1024;
const ALLOWED_BANNER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const COIN_BANNER_BUCKET = "coin-banners";
const MAX_TOTAL_DEVS = 5; // initiator + up to 4 invitees

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeTrim(v: any): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function looksLikeSolAddress(s: string) {
  return s.length >= 32 && s.length <= 50;
}

function extFromType(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "bin";
}

async function getViewerWallet() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

async function requireDev(wallet: string) {
  const sb = supabaseAdmin();
  const prof = await sb.from("dev_profiles").select("wallet").eq("wallet", wallet).maybeSingle();
  if (!prof.error && prof.data?.wallet) return true;
  const { data: user } = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle();
  const role = (user?.role ?? null) as string | null;
  return role === "dev" || role === "admin";
}

async function uploadCollabBanner(
  sb: ReturnType<typeof supabaseAdmin>,
  wallet: string,
  collabId: string,
  file: File
) {
  if (!ALLOWED_BANNER_TYPES.has(file.type)) throw new Error("Invalid banner type. Allowed: jpeg, png, webp.");
  if (file.size <= 0) throw new Error("Empty banner file.");
  if (file.size > MAX_BANNER_BYTES) throw new Error("Banner too large (max 15MB).");

  const ext = extFromType(file.type);
  const path = `collab/${wallet}/${collabId}/banner.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error } = await sb.storage.from(COIN_BANNER_BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: true
  });

  if (error) throw new Error(error.message);
  return path;
}

function pickBannerFile(fd: FormData): File | null {
  for (const k of ["file", "banner", "banner_file"]) {
    const v = fd.get(k);
    if (v && v instanceof File) return v;
  }
  return null;
}

// ─── POST /api/collab ─────────────────────────────────────────────────────────
// Creates a new pending collab launch and sends invites to the listed devs.
// Body: multipart/form-data with fields:
//   token_address (required)
//   title, description (optional)
//   banner / file (optional image)
//   invite_wallets (JSON array of wallet strings, 1–4)

export async function POST(req: Request) {
  try {
    const initiatorWallet = await getViewerWallet();
    if (!initiatorWallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    if (!(await requireDev(initiatorWallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const sb = supabaseAdmin();
    const ct = req.headers.get("content-type") || "";

    let token_address: string | null = null;
    let title: string | null = null;
    let description: string | null = null;
    let bannerFile: File | null = null;
    let inviteWallets: string[] = [];

    // ── Parse body ────────────────────────────────────────────────────────────
    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      token_address = safeTrim(fd.get("token_address"));
      title = safeTrim(fd.get("title"));
      description = safeTrim(fd.get("description"));
      bannerFile = pickBannerFile(fd);

      // invite_wallets comes as a JSON string: '["wallet1","wallet2"]'
      const raw = fd.get("invite_wallets");
      if (typeof raw === "string") {
        try { inviteWallets = JSON.parse(raw); } catch { inviteWallets = []; }
      }
    } else {
      const body = await req.json().catch(() => null);
      token_address = typeof body?.token_address === "string" ? body.token_address.trim() : null;
      title = typeof body?.title === "string" ? body.title.trim() || null : null;
      description = typeof body?.description === "string" ? body.description.trim() || null : null;
      inviteWallets = Array.isArray(body?.invite_wallets) ? body.invite_wallets : [];
    }

    // ── Validate token address ────────────────────────────────────────────────
    if (!token_address || !looksLikeSolAddress(token_address)) {
      return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
    }

    // ── Validate invitees ─────────────────────────────────────────────────────
    // Clean + dedupe
    inviteWallets = Array.from(
      new Set(
        inviteWallets
          .map((w: any) => (typeof w === "string" ? w.trim() : ""))
          .filter(Boolean)
      )
    );

    // Remove initiator if they accidentally added themselves
    inviteWallets = inviteWallets.filter((w) => w !== initiatorWallet);

    if (inviteWallets.length === 0) {
      return NextResponse.json({ error: "Add at least one dev to invite" }, { status: 400 });
    }

    if (inviteWallets.length > MAX_TOTAL_DEVS - 1) {
      return NextResponse.json({ error: `Max ${MAX_TOTAL_DEVS - 1} invited devs (5 total including you)` }, { status: 400 });
    }

    // Check all invited wallets are real devs
    const { data: devProfiles } = await sb
      .from("dev_profiles")
      .select("wallet, display_name")
      .in("wallet", inviteWallets);

    const foundWallets = new Set((devProfiles ?? []).map((p: any) => p.wallet));
    const notFound = inviteWallets.filter((w) => !foundWallets.has(w));

    if (notFound.length > 0) {
      return NextResponse.json(
        { error: `These wallets are not registered devs: ${notFound.join(", ")}` },
        { status: 400 }
      );
    }

    // ── Create the collab launch row ──────────────────────────────────────────
    const { data: collab, error: collabErr } = await sb
      .from("collab_launches")
      .insert({
        initiator_wallet: initiatorWallet,
        token_address,
        title,
        description,
        status: "pending"
      })
      .select("id, initiator_wallet, token_address, title, description, status, created_at")
      .single();

    if (collabErr) return NextResponse.json({ error: collabErr.message }, { status: 500 });

    // ── Upload banner if provided ─────────────────────────────────────────────
    let banner_path: string | null = null;

    if (bannerFile) {
      try {
        banner_path = await uploadCollabBanner(sb, initiatorWallet, String(collab.id), bannerFile);
        await sb.from("collab_launches").update({ banner_path }).eq("id", collab.id);
      } catch (e: any) {
        // Don't fail the whole thing — just warn
        console.error("Collab banner upload failed:", e?.message);
      }
    }

    // ── Create invite rows ────────────────────────────────────────────────────
    const inviteRows = inviteWallets.map((w) => ({
      collab_id: collab.id,
      dev_wallet: w,
      status: "pending"
    }));

    const { error: inviteErr } = await sb.from("collab_launch_invites").insert(inviteRows);
    if (inviteErr) return NextResponse.json({ error: inviteErr.message }, { status: 500 });

    // ── Send notifications to each invited dev ────────────────────────────────
    const initiatorProfile = await sb
      .from("dev_profiles")
      .select("display_name")
      .eq("wallet", initiatorWallet)
      .maybeSingle();

    const initiatorName = initiatorProfile.data?.display_name?.trim() ||
      `${initiatorWallet.slice(0, 4)}…${initiatorWallet.slice(-4)}`;

    const notiRows = inviteWallets.map((w) => ({
      recipient_wallet: w,
      actor_wallet: initiatorWallet,
      type: "collab_invite",
      title: `invited you to a collab coin launch`,
      body: title ? `"${title}"` : token_address,
      link: `/dev/profile`,
      seen: false
    }));

    await sb.from("notifications").insert(notiRows).catch(() => null);

    return NextResponse.json({
      ok: true,
      collab: { ...collab, banner_path }
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to create collab launch", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
