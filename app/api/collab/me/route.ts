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

async function signBannerUrl(
  sb: ReturnType<typeof supabaseAdmin>,
  path: string | null
) {
  if (!path) return null;
  const { data, error } = await sb.storage
    .from("coin-banners")
    .createSignedUrl(path, 60 * 30);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// ─── GET /api/collab/me ───────────────────────────────────────────────────────
// Returns two lists for the signed-in dev:
//
//   initiated[]  — collabs this dev started, each with full invite breakdown
//                  (who accepted, declined, is pending) so they can track progress
//
//   invited[]    — collabs this dev was invited to, each with:
//                  - their own invite status (pending / accepted / declined)
//                  - the collab details (coin info, initiator name)
//                  - the other invitees + their statuses (so they can see who else is in)

export async function GET() {
  try {
    const viewerWallet = await getViewerWallet();
    if (!viewerWallet) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const sb = supabaseAdmin();

    // ── 1. Collabs this dev INITIATED ─────────────────────────────────────────
    const { data: initiatedRaw, error: initErr } = await sb
      .from("collab_launches")
      .select("id, initiator_wallet, token_address, title, description, banner_path, status, coin_id, created_at, launched_at")
      .eq("initiator_wallet", viewerWallet)
      .order("created_at", { ascending: false })
      .limit(20);

    if (initErr) return NextResponse.json({ error: initErr.message }, { status: 500 });

    // ── 2. Collabs this dev was INVITED to ────────────────────────────────────
    const { data: myInvitesRaw, error: invErr } = await sb
      .from("collab_launch_invites")
      .select("id, collab_id, status, responded_at, created_at")
      .eq("dev_wallet", viewerWallet)
      .order("created_at", { ascending: false })
      .limit(20);

    if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

    // ── 3. Load full collab details for invited ones ──────────────────────────
    const invitedCollabIds = (myInvitesRaw ?? []).map((i: any) => i.collab_id as string);

    let invitedCollabsRaw: any[] = [];
    if (invitedCollabIds.length > 0) {
      const { data, error } = await sb
        .from("collab_launches")
        .select("id, initiator_wallet, token_address, title, description, banner_path, status, coin_id, created_at, launched_at")
        .in("id", invitedCollabIds);
      if (!error) invitedCollabsRaw = data ?? [];
    }

    // ── 4. Load ALL invite rows for both sets of collabs ──────────────────────
    const allCollabIds = Array.from(new Set([
      ...(initiatedRaw ?? []).map((c: any) => c.id as string),
      ...invitedCollabIds
    ]));

    let allInviteRows: any[] = [];
    if (allCollabIds.length > 0) {
      const { data } = await sb
        .from("collab_launch_invites")
        .select("collab_id, dev_wallet, status, responded_at")
        .in("collab_id", allCollabIds);
      allInviteRows = data ?? [];
    }

    // ── 5. Load dev profile names + pfps for everyone involved ───────────────
    const allWallets = Array.from(new Set([
      ...(initiatedRaw ?? []).map((c: any) => c.initiator_wallet as string),
      ...invitedCollabsRaw.map((c: any) => c.initiator_wallet as string),
      ...allInviteRows.map((i: any) => i.dev_wallet as string),
      viewerWallet
    ]));

    const { data: profiles } = await sb
      .from("dev_profiles")
      .select("wallet, display_name, pfp_path")
      .in("wallet", allWallets);

    // Sign pfp urls
    const profileMap = new Map<string, { name: string | null; pfpUrl: string | null }>();
    for (const p of profiles ?? []) {
      let pfpUrl: string | null = null;
      if (p.pfp_path) {
        const { data: signed } = await sb.storage
          .from("dev-pfps")
          .createSignedUrl(p.pfp_path, 60 * 30);
        pfpUrl = signed?.signedUrl ?? null;
      }
      profileMap.set(p.wallet, { name: p.display_name ?? null, pfpUrl });
    }

    function devMeta(wallet: string) {
      const m = profileMap.get(wallet);
      return {
        wallet,
        display_name: m?.name ?? null,
        pfp_url: m?.pfpUrl ?? null
      };
    }

    // ── 6. Group invite rows by collab id ─────────────────────────────────────
    const invitesByCollab = new Map<string, any[]>();
    for (const row of allInviteRows) {
      const id = row.collab_id as string;
      if (!invitesByCollab.has(id)) invitesByCollab.set(id, []);
      invitesByCollab.get(id)!.push(row);
    }

    // ── 7. Shape the INITIATED list ───────────────────────────────────────────
    const initiated = await Promise.all(
      (initiatedRaw ?? []).map(async (c: any) => {
        const invites = (invitesByCollab.get(c.id) ?? []).map((i: any) => ({
          ...devMeta(i.dev_wallet),
          status: i.status,
          responded_at: i.responded_at
        }));

        const pendingCount = invites.filter((i) => i.status === "pending").length;
        const acceptedCount = invites.filter((i) => i.status === "accepted").length;
        const declinedCount = invites.filter((i) => i.status === "declined").length;

        return {
          id: c.id,
          token_address: c.token_address,
          title: c.title,
          description: c.description,
          banner_url: await signBannerUrl(sb, c.banner_path),
          status: c.status,
          coin_id: c.coin_id,
          created_at: c.created_at,
          launched_at: c.launched_at,
          invites,
          pendingCount,
          acceptedCount,
          declinedCount
        };
      })
    );

    // ── 8. Shape the INVITED list ─────────────────────────────────────────────
    const inviteStatusByCollab = new Map(
      (myInvitesRaw ?? []).map((i: any) => [i.collab_id as string, i])
    );

    const invited = await Promise.all(
      invitedCollabsRaw.map(async (c: any) => {
        const myInvite = inviteStatusByCollab.get(c.id);

        // Other invitees (excluding the viewer)
        const otherInvites = (invitesByCollab.get(c.id) ?? [])
          .filter((i: any) => i.dev_wallet !== viewerWallet)
          .map((i: any) => ({
            ...devMeta(i.dev_wallet),
            status: i.status,
            responded_at: i.responded_at
          }));

        return {
          id: c.id,
          token_address: c.token_address,
          title: c.title,
          description: c.description,
          banner_url: await signBannerUrl(sb, c.banner_path),
          status: c.status,
          coin_id: c.coin_id,
          created_at: c.created_at,
          launched_at: c.launched_at,
          initiator: devMeta(c.initiator_wallet),
          my_invite_status: myInvite?.status ?? "pending",
          my_invite_id: myInvite?.id ?? null,
          other_invitees: otherInvites
        };
      })
    );

    // ── 9. Pending invite count (for the red dot) ─────────────────────────────
    const pendingInviteCount = invited.filter(
      (c) => c.my_invite_status === "pending" && c.status === "pending"
    ).length;

    return NextResponse.json({
      ok: true,
      initiated,
      invited,
      pendingInviteCount
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load collab data", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
