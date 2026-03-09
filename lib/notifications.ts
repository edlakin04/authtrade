import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Called whenever a dev creates a post or lists a new coin.
// Fans out a notification row to every follower of that dev.
export async function createNotificationsForFollowers(params: {
  actorWallet: string;       // the dev who did the action
  type: "new_post" | "new_coin";
  title: string;             // e.g. "CryptoBuilder posted an update"
  body?: string | null;      // e.g. first 80 chars of post content, or coin name
  link: string;              // e.g. "/dev/ABC123" or "/coin/XYZ789"
}) {
  try {
    const sb = supabaseAdmin();

    // Find everyone following this dev
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
      seen: false,
    }));

    // Insert all at once — fire and forget, don't block the main response
    await sb.from("notifications").insert(rows);
  } catch {
    // Never throw — notification failure should never break posting/coin creation
  }
}
