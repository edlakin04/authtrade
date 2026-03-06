// app/api/dev/bidding-ad/entry-payment-tx/route.ts
import { NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction
} from "@solana/web3.js";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RoleRow = { role: string | null };

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDateOnlyUtc(d: Date) {
  return d.toISOString().slice(0, 10);
}

function currentTargetDate(now = new Date()) {
  const todayUtc = startOfUtcDay(now);
  return toDateOnlyUtc(addUtcDays(todayUtc, 1));
}

function scheduleForTargetDate(targetDate: string) {
  const day = new Date(`${targetDate}T00:00:00.000Z`);
  const prevDay = addUtcDays(day, -1);

  const entryOpensAt = new Date(
    Date.UTC(prevDay.getUTCFullYear(), prevDay.getUTCMonth(), prevDay.getUTCDate(), 23, 0, 0, 0)
  );
  const auctionStartsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 11, 0, 0, 0)
  );
  const auctionEndsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12, 0, 0, 0)
  );

  return {
    entryOpensAt,
    auctionStartsAt,
    auctionEndsAt
  };
}

function getTreasuryWallet() {
  const wallet =
    process.env.TREASURY_WALLET ||
    process.env.NEXT_PUBLIC_TREASURY_WALLET ||
    "";

  if (!wallet.trim()) {
    throw new Error("Server missing TREASURY_WALLET / NEXT_PUBLIC_TREASURY_WALLET");
  }

  return wallet.trim();
}

function getEntryFeeSol() {
  const solRaw = process.env.BIDDING_AD_ENTRY_FEE_SOL ?? "1";
  const sol = Number(solRaw);

  if (!Number.isFinite(sol) || sol <= 0) {
    throw new Error("Invalid BIDDING_AD_ENTRY_FEE_SOL env value");
  }

  return sol;
}

function getEntryFeeLamports() {
  return Math.round(getEntryFeeSol() * 1_000_000_000);
}

async function getViewerWallet() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await readSessionToken(token).catch(() => null);
  return session?.wallet ?? null;
}

async function requireDev(wallet: string) {
  const sb = supabaseAdmin();

  const prof = await sb.from("dev_profiles").select("wallet").eq("wallet", wallet).maybeSingle();
  if (!prof.error && prof.data?.wallet) return true;

  const { data: user } = await sb.from("users").select("role").eq("wallet", wallet).maybeSingle<RoleRow>();
  const role = (user?.role ?? null) as string | null;
  return role === "dev" || role === "admin";
}

async function getOrCreateAuction(targetDate: string) {
  const sb = supabaseAdmin();

  const existingRes = await sb
    .from("bidding_ad_auctions")
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .eq("target_date", targetDate)
    .maybeSingle();

  if (existingRes.error) throw new Error(existingRes.error.message);
  if (existingRes.data) return existingRes.data;

  const schedule = scheduleForTargetDate(targetDate);

  const insertRes = await sb
    .from("bidding_ad_auctions")
    .insert({
      target_date: targetDate,
      entry_opens_at: schedule.entryOpensAt.toISOString(),
      auction_starts_at: schedule.auctionStartsAt.toISOString(),
      auction_ends_at: schedule.auctionEndsAt.toISOString(),
      status: "scheduled"
    })
    .select(
      "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
    )
    .single();

  if (insertRes.error) {
    const retryRes = await sb
      .from("bidding_ad_auctions")
      .select(
        "id, target_date, entry_opens_at, auction_starts_at, auction_ends_at, status, highest_bid_lamports, highest_bidder_wallet, highest_bid_entry_id, last_bid_at, bid_count, created_at, updated_at"
      )
      .eq("target_date", targetDate)
      .maybeSingle();

    if (retryRes.error) throw new Error(retryRes.error.message);
    if (!retryRes.data) throw new Error(insertRes.error.message);
    return retryRes.data;
  }

  return insertRes.data;
}

async function getEntry(wallet: string, targetDate: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bidding_ad_entries")
    .select(
      "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, entry_payment_signature, entry_payment_confirmed_at, created_at, updated_at"
    )
    .eq("dev_wallet", wallet)
    .eq("target_date", targetDate)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function POST(req: Request) {
  try {
    const wallet = await getViewerWallet();
    if (!wallet) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    if (!(await requireDev(wallet))) {
      return NextResponse.json({ error: "Not a dev" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const targetDate = ((body?.target_date as string | undefined)?.trim() || currentTargetDate());

    const auction = await getOrCreateAuction(targetDate);
    const entry = await getEntry(wallet, targetDate);

    if (!entry) {
      return NextResponse.json({ error: "No bidding ad entry found for this target date" }, { status: 404 });
    }

    if (entry.entry_payment_status === "paid") {
      return NextResponse.json({ error: "Entry fee already paid" }, { status: 400 });
    }

    const now = new Date();
    const entryOpensAt = new Date(String(auction.entry_opens_at));
    const auctionStartsAt = new Date(String(auction.auction_starts_at));

    if (now < entryOpensAt) {
      return NextResponse.json({ error: "Bidding Ad entry is not open yet" }, { status: 400 });
    }

    if (now >= auctionStartsAt) {
      return NextResponse.json({ error: "Bidding Ad entry is closed for that day" }, { status: 400 });
    }

    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: "Server missing SOLANA_RPC_URL" }, { status: 500 });
    }

    const treasuryWallet = getTreasuryWallet();
    const lamports = getEntryFeeLamports();

    const connection = new Connection(rpcUrl, "confirmed");
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

    const fromPubkey = new PublicKey(wallet);
    const toPubkey = new PublicKey(treasuryWallet);

    const tx = new Transaction({
      feePayer: fromPubkey,
      recentBlockhash: blockhash
    }).add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports
      })
    );

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    });

    return NextResponse.json({
      ok: true,
      targetDate,
      entry: {
        id: String(entry.id),
        target_date: String(entry.target_date),
        entry_payment_status: entry.entry_payment_status
      },
      payment: {
        treasuryWallet,
        amount_sol: getEntryFeeSol(),
        amount_lamports: lamports
      },
      tx: {
        serialized_base64: serialized.toString("base64"),
        blockhash,
        lastValidBlockHeight
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Failed to create bidding ad entry payment transaction",
        details: e?.message ?? String(e)
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST to create the bidding ad entry payment transaction." },
    { status: 405 }
  );
}
