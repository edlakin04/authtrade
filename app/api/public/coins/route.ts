import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  const sb = supabaseAdmin();

  let query = sb
    .from("coins")
    .select("id, wallet, token_address, title, description, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (q) {
    // basic: match token address OR title
    query = query.or(`token_address.ilike.%${q}%,title.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, coins: data ?? [] });
}
