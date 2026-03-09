import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

async function getViewerWallet() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

// GET /api/notifications
// Returns the 50 most recent notifications + unseenCount for the red dot
export async function GET() {
  const wallet = await getViewerWallet();
  if (!wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("notifications")
    .select("id, actor_wallet, type, title, body, link, seen, created_at")
    .eq("recipient_wallet", wallet)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const notifications = data ?? [];
  const unseenCount = notifications.filter((n) => !n.seen).length;

  return NextResponse.json({ ok: true, notifications, unseenCount });
}

// PATCH /api/notifications
// Marks ALL notifications as seen (called when user opens the notifications tab)
export async function PATCH() {
  const wallet = await getViewerWallet();
  if (!wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const sb = supabaseAdmin();

  const { error } = await sb
    .from("notifications")
    .update({ seen: true })
    .eq("recipient_wallet", wallet)
    .eq("seen", false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/notifications
// Body: {}            -> clears ALL notifications for the user
// Body: { id: "..." } -> clears a single notification by id
export async function DELETE(req: Request) {
  const wallet = await getViewerWallet();
  if (!wallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const sb = supabaseAdmin();

  if (body?.id) {
    const { error } = await sb
      .from("notifications")
      .delete()
      .eq("id", body.id)
      .eq("recipient_wallet", wallet);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, cleared: "single" });
  }

  const { error } = await sb
    .from("notifications")
    .delete()
    .eq("recipient_wallet", wallet);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, cleared: "all" });
}
