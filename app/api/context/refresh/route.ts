import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { createSubToken, subCookie } from "@/lib/subscription";
import { createRoleToken, roleCookie } from "@/lib/role";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ ok: false }, { status: 401 });

  const sessionData = await readSessionToken(sessionToken).catch(() => null);
  if (!sessionData?.wallet) return NextResponse.json({ ok: false }, { status: 401 });

  const sb = supabaseAdmin();

  // Ensure user exists
  await sb.from("users").upsert({ wallet: sessionData.wallet });

  // Get role (default to user)
  const { data: userRow } = await sb
    .from("users")
    .select("role")
    .eq("wallet", sessionData.wallet)
    .maybeSingle();

  const role = (userRow?.role === "dev" || userRow?.role === "admin") ? userRow.role : "user";

  // Get subscription paid_until
  const { data: subRow } = await sb
    .from("subscriptions")
    .select("paid_until")
    .eq("wallet", sessionData.wallet)
    .maybeSingle();

  const paidUntilMs = subRow?.paid_until ? new Date(subRow.paid_until).getTime() : 0;
  const subscribedActive = paidUntilMs > Date.now();

  const res = NextResponse.json({
    ok: true,
    role,
    subscribedActive,
    paidUntilMs
  });

  // Set role cookie
  const roleToken = await createRoleToken({ wallet: sessionData.wallet, role });
  res.headers.append("Set-Cookie", roleCookie(roleToken));

  // Set sub cookie if active
  if (subscribedActive) {
    const subToken = await createSubToken({ wallet: sessionData.wallet, paidUntilMs });
    res.headers.append("Set-Cookie", subCookie(subToken));
  }

  return res;
}
