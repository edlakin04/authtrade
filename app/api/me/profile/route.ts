import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function getViewerWallet() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

async function signedUserPfp(sb: ReturnType<typeof supabaseAdmin>, path?: string | null) {
  if (!path) return null;
  const { data, error } = await sb.storage.from("userpfp").createSignedUrl(path, 60 * 30);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function GET() {
  try {
    const wallet = await getViewerWallet();
    if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = supabaseAdmin();

    // keep users table consistent
    await sb.from("users").upsert({ wallet }, { onConflict: "wallet" });

    const { data: prof, error } = await sb
      .from("user_profiles")
      .select("wallet, display_name, pfp_path, updated_at")
      .eq("wallet", wallet)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const pfp_url = await signedUserPfp(sb, prof?.pfp_path ?? null);

    return NextResponse.json({
      ok: true,
      profile: {
        wallet,
        display_name: prof?.display_name ?? "",
        pfp_path: prof?.pfp_path ?? null,
        pfp_url
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load profile", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const wallet = await getViewerWallet();
    if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const display_name = typeof body?.display_name === "string" ? body.display_name.trim() : "";

    if (display_name.length > 40) {
      return NextResponse.json({ error: "Name too long (max 40 chars)" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    await sb.from("users").upsert({ wallet }, { onConflict: "wallet" });

    const { error } = await sb
      .from("user_profiles")
      .upsert(
        {
          wallet,
          display_name: display_name || null
        },
        { onConflict: "wallet" }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to save profile", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
