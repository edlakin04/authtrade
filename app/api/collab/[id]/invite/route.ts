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

function shortAddr(w: string) {
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

// ─── PATCH /api/collab/[id]/invite ───────────────────────────────────────────
// Body: { action: "accept" | "decline" }
// Called by an invited dev to respond to their invite.
// If every invitee has now accepted → auto-launches the coin + community.
// If anyone declines → notifies the initiator but keeps status pending
//   (initiator can still cancel or wait for others).

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id: collabId } = await ctx.params;
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = body?.action as "accept" | "decline" | undefined;

    if (action !== "accept" && action !== "decline") {
      return NextResponse.json({ error: "action must be 'accept' or 'decline'" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // ── Load the collab ───────────────────────────────────────────────────────
    const { data: collab, error: collabErr } = await sb
      .from("collab_launches")
      .select("id, initiator_wallet, token_address, title, description, banner_path, status, coin_id")
      .eq("id", collabId)
      .maybeSingle();

    if (collabErr) return NextResponse.json({ error: collabErr.message }, { status: 500 });
    if (!collab) return NextResponse.json({ error: "Collab not found" }, { status: 404 });
    if (collab.status !== "pending") {
      return NextResponse.json({ error: `Collab is already ${collab.status}` }, { status: 400 });
    }

    // ── Verify this dev was actually invited ──────────────────────────────────
    const { data: invite, error: inviteErr } = await sb
      .from("collab_launch_invites")
      .select("id, status")
      .eq("collab_id", collabId)
      .eq("dev_wallet", viewerWallet)
      .maybeSingle();

    if (inviteErr) return NextResponse.json({ error: inviteErr.message }, { status: 500 });
    if (!invite) return NextResponse.json({ error: "You were not invited to this collab" }, { status: 403 });
    if (invite.status !== "pending") {
      return NextResponse.json({ error: `You already ${invite.status} this invite` }, { status: 400 });
    }

    // ── Update this invite's status ───────────────────────────────────────────
    const { error: updateErr } = await sb
      .from("collab_launch_invites")
      .update({ status: action === "accept" ? "accepted" : "declined", responded_at: new Date().toISOString() })
      .eq("id", invite.id);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // ── Notify the initiator of the response ──────────────────────────────────
    const devName = shortAddr(viewerWallet);
    const coinLabel = collab.title ? `"${collab.title}"` : collab.token_address;

    try { await sb.from("notifications").insert({
      recipient_wallet: collab.initiator_wallet,
      actor_wallet: viewerWallet,
      type: action === "accept" ? "collab_accepted" : "collab_declined",
      title: action === "accept"
        ? `accepted your collab invite for ${coinLabel}`
        : `declined your collab invite for ${coinLabel}`,
      body: `${devName} ${action === "accept" ? "is in!" : "won't be joining."}`,
      link: `/dev/profile`,
      seen: false
    }); } catch { /* silent */ }

    // ── If declined → return early, no launch yet ─────────────────────────────
    if (action === "decline") {
      return NextResponse.json({ ok: true, result: "declined" });
    }

    // ── Check if ALL invites are now accepted ─────────────────────────────────
    const { data: allInvites, error: allErr } = await sb
      .from("collab_launch_invites")
      .select("dev_wallet, status")
      .eq("collab_id", collabId);

    if (allErr) return NextResponse.json({ error: allErr.message }, { status: 500 });

    const pendingCount = (allInvites ?? []).filter((i: any) => i.status === "pending").length;
    const declinedCount = (allInvites ?? []).filter((i: any) => i.status === "declined").length;
    const acceptedWallets = (allInvites ?? [])
      .filter((i: any) => i.status === "accepted")
      .map((i: any) => i.dev_wallet as string);

    // Still waiting on others
    if (pendingCount > 0) {
      return NextResponse.json({ ok: true, result: "accepted", pendingCount });
    }

    // Someone declined — can't auto-launch
    if (declinedCount > 0) {
      return NextResponse.json({ ok: true, result: "accepted_but_others_declined", declinedCount });
    }

    // ── ALL accepted → launch the coin ───────────────────────────────────────
    // 1) Create the coin row (owned by the initiator)
    const { data: coin, error: coinErr } = await sb
      .from("coins")
      .insert({
        wallet: collab.initiator_wallet,
        token_address: collab.token_address,
        title: collab.title,
        description: collab.description,
        banner_path: collab.banner_path ?? null
      })
      .select("id, wallet, token_address, title, description, created_at, banner_path")
      .single();

    if (coinErr) return NextResponse.json({ error: coinErr.message }, { status: 500 });

    // 2) Create the community (owned by initiator)
    const { data: community, error: commErr } = await sb
      .from("coin_communities")
      .insert({
        coin_id: coin.id,
        dev_wallet: collab.initiator_wallet,
        title: collab.title || null
      })
      .select("id")
      .single();

    if (commErr) return NextResponse.json({ error: commErr.message }, { status: 500 });

    // 3) Add ALL devs (initiator + all acceptors) as community members with role "dev"
    const allDevWallets = [collab.initiator_wallet, ...acceptedWallets];

    const memberRows = allDevWallets.map((w) => ({
      community_id: community.id,
      member_wallet: w,
      role: "dev"
    }));

    await sb
      .from("community_members")
      .upsert(memberRows, { onConflict: "community_id,member_wallet" });

    // 4) Mark the collab as launched + link the coin
    await sb
      .from("collab_launches")
      .update({
        status: "launched",
        coin_id: coin.id,
        launched_at: new Date().toISOString()
      })
      .eq("id", collabId);

    // 5) Notify EVERYONE involved that the coin is now live
    const coinLink = `/coin/${encodeURIComponent(String(coin.id))}`;
    const launchNotiRows = allDevWallets.map((w) => ({
      recipient_wallet: w,
      actor_wallet: collab.initiator_wallet,
      type: "collab_launched",
      title: `Collab coin is now live!`,
      body: collab.title ? `"${collab.title}" has launched` : `${collab.token_address} has launched`,
      link: coinLink,
      seen: false
    }));

    try { await sb.from("notifications").insert(launchNotiRows); } catch { /* silent */ }

    return NextResponse.json({
      ok: true,
      result: "launched",
      coin,
      community_id: community.id
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to process invite", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
