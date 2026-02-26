import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const code = (body?.code as string | undefined)?.trim();

  if (!code) return NextResponse.json({ error: "Missing invite code" }, { status: 400 });

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const sessionData = await readSessionToken(sessionToken).catch(() => null);
  if (!sessionData?.wallet) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const sb = supabaseAdmin();

  // Ensure user exists
  await sb.from("users").upsert({ wallet: sessionData.wallet });

  const codeHash = sha256Hex(code);

  const { data: inviteRow, error: invErr } = await sb
    .from("invite_codes")
    .select("*")
    .eq("code_hash", codeHash)
    .maybeSingle();

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
  if (!inviteRow) return NextResponse.json({ error: "Invalid invite code" }, { status: 400 });
  if (inviteRow.used_at) return NextResponse.json({ error: "Invite code already used" }, { status: 400 });

  if (inviteRow.expires_at && new Date(inviteRow.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Invite code expired" }, { status: 400 });
  }

  // Mark used + promote to dev
  const { error: useErr } = await sb
    .from("invite_codes")
    .update({ used_at: new Date().toISOString(), used_by_wallet: sessionData.wallet })
    .eq("code_hash", codeHash);

  if (useErr) return NextResponse.json({ error: useErr.message }, { status: 500 });

  const { error: userErr } = await sb
    .from("users")
    .update({ role: "dev", dev_access_type: "invite" })
    .eq("wallet", sessionData.wallet);

  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
