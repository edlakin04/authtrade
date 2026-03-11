import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type NotificationType =
  | "new_post"
  | "new_coin"
  | "collab_invite"
  | "collab_accepted"
  | "collab_declined"
  | "collab_launched"
  | "collab_cancelled"
  | "stream_started";

// ─── Follower fan-out ─────────────────────────────────────────────────────────
// Used by /api/dev/posts and /api/dev/coins.
// Inserts one notification row per follower of the acting dev.

export async function createNotificationsForFollowers(params: {
  actorWallet: string;
  type: "new_post" | "new_coin";
  title: string;
  body?: string | null;
  link: string;
}) {
  try {
    const sb = supabaseAdmin();

    const { data: follows, error: followErr } = await sb
      .from("follows")
      .select("follower_wallet")
      .eq("dev_wallet", params.actorWallet);

    if (followErr || !follows || follows.length === 0) return;

    const rows = follows.map((f) => ({
      recipient_wallet: f.follower_wallet,
      actor_wallet: params.actorWallet,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      link: params.link,
      seen: false
    }));

    await sb.from("notifications").insert(rows);
  } catch {
    // Never throw — notification failure should never break the main action
  }
}

// ─── Direct notification ──────────────────────────────────────────────────────
// Used by collab routes to send to specific wallets (not followers).
// Pass an array of recipient wallets — inserts one row per recipient.

export async function createNotificationsForWallets(params: {
  recipientWallets: string[];
  actorWallet: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link: string;
}) {
  try {
    if (!params.recipientWallets.length) return;

    const sb = supabaseAdmin();

    const rows = params.recipientWallets.map((w) => ({
      recipient_wallet: w,
      actor_wallet: params.actorWallet,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      link: params.link,
      seen: false
    }));

    await sb.from("notifications").insert(rows);
  } catch {
    // Never throw
  }
}
