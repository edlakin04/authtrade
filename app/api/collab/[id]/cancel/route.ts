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

// ─── DELETE /api/collab/[id]/cancel ──────────────────────────────────────────
// Initiator-only. Only works while status is still "pending".
// Marks the collab as cancelled and notifies all invited devs.

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id: collabId } = await ctx.params;
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const sb = supabaseAdmin();

    // ── Load the collab ───────────────────────────────────────────────────────
    const { data: collab, error: collabErr } = await sb
      .from("collab_launches")
      .select("id, initiator_wallet, title, token_address, status")
      .eq("id", collabId)
      .maybeSingle();

    if (collabErr) return NextResponse.json({ error: collabErr.message }, { status: 500 });
    if (!collab) return NextResponse.json({ error: "Collab not found" }, { status: 404 });

    // ── Only the initiator can cancel ─────────────────────────────────────────
    if (collab.initiator_wallet !== viewerWallet) {
      return NextResponse.json({ error: "Only the initiator can cancel this launch" }, { status: 403 });
    }

    // ── Can only cancel while pending ─────────────────────────────────────────
    if (collab.status !== "pending") {
      return NextResponse.json(
        { error: `Cannot cancel — collab is already ${collab.status}` },
        { status: 400 }
      );
    }

    // ── Mark as cancelled ─────────────────────────────────────────────────────
    const { error: updateErr } = await sb
      .from("collab_launches")
      .update({ status: "cancelled" })
      .eq("id", collabId);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // ── Load all invited devs so we can notify them ───────────────────────────
    const { data: invites } = await sb
      .from("collab_launch_invites")
      .select("dev_wallet")
      .eq("collab_id", collabId);

    const invitedWallets = (invites ?? []).map((i: any) => i.dev_wallet as string);

    // ── Notify every invited dev the launch was cancelled ─────────────────────
    if (invitedWallets.length > 0) {
      const coinLabel = collab.title
        ? `"${collab.title}"`
        : collab.token_address;

      const notiRows = invitedWallets.map((w) => ({
        recipient_wallet: w,
        actor_wallet: viewerWallet,
        type: "collab_cancelled",
        title: `cancelled the collab launch for ${coinLabel}`,
        body: "The launch has been called off by the initiator.",
        link: `/dev/profile`,
        seen: false
      }));

      await sb.from("notifications").insert(notiRows).catch(() => null);
    }

    return NextResponse.json({ ok: true, cancelled: collabId });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to cancel collab", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
