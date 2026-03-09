import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createNotificationsForFollowers } from "@/lib/notifications";

export const dynamic = "force-dynamic";

async function getViewerWallet() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

async function requireDev(wallet: string) {
  const sb = supabaseAdmin();
  const { data } = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle();
  return data?.role === "dev" || data?.role === "admin";
}

function normalizeOptions(raw: any): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((o: any) => (typeof o === "string" ? o.trim() : ""))
    .filter(Boolean)
    .slice(0, 6);
}

function safeTrim(v: any): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function parsePollOptionsFromFormData(fd: FormData): string[] {
  // Your UI sends: fd.append("poll_options", JSON.stringify(opts))
  const rawAll = fd.getAll("poll_options");

  // If exactly one string, it might be JSON.
  if (rawAll.length === 1 && typeof rawAll[0] === "string") {
    const one = (rawAll[0] as string).trim();

    // Try JSON first (expected)
    if (one.startsWith("[") || one.startsWith("{")) {
      try {
        const parsed = JSON.parse(one);
        return normalizeOptions(parsed);
      } catch {
        // fall through
      }
    }

    // Otherwise treat as a single label
    return normalizeOptions([one]);
  }

  // Multiple values: treat as labels
  return rawAll
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, 6);
}

function sanitizeFilename(name: string) {
  return (name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

async function uploadDevPostFile(sb: ReturnType<typeof supabaseAdmin>, wallet: string, file: File) {
  const bucket = "dev-posts";

  // 5MB guard
  const maxBytes = 5 * 1024 * 1024;
  const size = (file as any)?.size;
  if (typeof size === "number" && size > maxBytes) {
    throw new Error("Image too large (max 5MB).");
  }

  const filename = sanitizeFilename((file as any)?.name || "image");
  const path = `posts/${wallet}/${Date.now()}-${crypto.randomUUID()}-${filename}`;

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const { error } = await sb.storage.from(bucket).upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false
  });

  if (error) throw new Error(error.message);
  return path;
}

export async function POST(req: Request) {
  try {
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    if (!(await requireDev(viewerWallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const sb = supabaseAdmin();

    let content: string | null = null;
    let image_path: string | null = null;
    let pollQuestion: string | null = null;
    let pollOptions: string[] = [];

    const ct = req.headers.get("content-type") || "";

    // ✅ Support BOTH FormData (your UI) and JSON (older callers)
    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();

      content = safeTrim(fd.get("content"));
      pollQuestion = safeTrim(fd.get("poll_question"));
      pollOptions = parsePollOptionsFromFormData(fd);

      const file = fd.get("file");
      if (file && typeof file !== "string") {
        image_path = await uploadDevPostFile(sb, viewerWallet, file as File);
      } else {
        image_path = safeTrim(fd.get("image_path"));
      }
    } else {
      const body = await req.json().catch(() => null);

      content = typeof body?.content === "string" ? body.content.trim() || null : null;
      image_path = typeof body?.image_path === "string" ? body.image_path.trim() || null : null;

      pollQuestion = typeof body?.poll_question === "string" ? body.poll_question.trim() || null : null;
      pollOptions = normalizeOptions(body?.poll_options);
    }

    // ✅ poll valid only if question + 2+ options
    const hasPoll = !!(pollQuestion && pollQuestion.length >= 2 && pollOptions.length >= 2);

    // ✅ allow poll-only, image-only, or text-only
    const hasAny = !!(content || image_path || hasPoll);

    if (!hasAny) {
      return NextResponse.json(
        { error: "Nothing to post (add text, image, or a poll with 2+ options)." },
        { status: 400 }
      );
    }

    let pollId: string | null = null;

    /* ---------------- CREATE POLL ---------------- */
    if (hasPoll) {
      // ✅ matches your SQL: dev_post_polls.wallet
      const { data: poll, error: pollErr } = await sb
        .from("dev_post_polls")
        .insert({
          wallet: viewerWallet,
          question: pollQuestion
        })
        .select("id")
        .single();

      if (pollErr) return NextResponse.json({ error: pollErr.message }, { status: 500 });

      pollId = poll.id;

      const optionRows = pollOptions.map((label: string, i: number) => ({
        poll_id: pollId,
        label,
        sort_order: i
      }));

      const { error: optErr } = await sb.from("dev_post_poll_options").insert(optionRows);
      if (optErr) return NextResponse.json({ error: optErr.message }, { status: 500 });
    }

    /* ---------------- CREATE POST ---------------- */
    // ✅ dev_posts.content is NOT NULL in your DB, so always provide a string.
    // Prefer: content, else poll question (if poll-only), else empty string (image-only).
    const finalContent = content ?? (hasPoll ? pollQuestion! : "");

    const { data: post, error: postErr } = await sb
      .from("dev_posts")
      .insert({
        wallet: viewerWallet,
        content: finalContent,
        image_path,
        poll_id: pollId
      })
      .select("*")
      .single();

    if (postErr) return NextResponse.json({ error: postErr.message }, { status: 500 });

    // ── Notify followers ──────────────────────────────────────────────
    const preview = finalContent ? finalContent.slice(0, 80) + (finalContent.length > 80 ? "…" : "") : null;
    await createNotificationsForFollowers({
      actorWallet: viewerWallet,
      type: "new_post",
      title: "posted a new update",
      body: preview,
      link: `/dev/${encodeURIComponent(viewerWallet)}`,
    });
    // ─────────────────────────────────────────────────────────────────

    return NextResponse.json({ ok: true, post });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to create post", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
