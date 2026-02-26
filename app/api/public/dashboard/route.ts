import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const sb = supabaseAdmin();

  const profiles = await sb
    .from("dev_profiles")
    .select("wallet, display_name, bio, pfp_url, x_url, updated_at")
    .order("updated_at", { ascending: false })
    .limit(12);

  const posts = await sb
    .from("dev_posts")
    .select("id, wallet, content, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const coins = await sb
    .from("coins")
    .select("id, wallet, token_address, title, description, created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  if (profiles.error) return NextResponse.json({ error: profiles.error.message }, { status: 500 });
  if (posts.error) return NextResponse.json({ error: posts.error.message }, { status: 500 });
  if (coins.error) return NextResponse.json({ error: coins.error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    profiles: profiles.data ?? [],
    posts: posts.data ?? [],
    coins: coins.data ?? []
  });
}
