import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RoleRow = { role: string | null };

const BIDDING_AD_BANNER_BUCKET = "bidding-ad-banners";
const MAX_BANNER_BYTES = 15 * 1024 * 1024;
const ALLOWED_BANNER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 21, 0, 0, 0)
  );
  const auctionEndsAt = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 22, 0, 0, 0)
  );

  return {
    entryOpensAt,
    auctionStartsAt,
    auctionEndsAt
  };
}

function safeTrim(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function extFromType(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "bin";
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

async function getOwnedCoin(wallet: string, coinId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("coins")
    .select("id, wallet, token_address, title")
    .eq("id", coinId)
    .eq("wallet", wallet)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
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

async function uploadBiddingAdBanner(wallet: string, targetDate: string, coinId: string, file: File) {
  if (!ALLOWED_BANNER_TYPES.has(file.type)) {
    throw new Error("Invalid banner file type. Allowed: JPG, PNG, WEBP.");
  }

  if (file.size <= 0) {
    throw new Error("Empty banner file.");
  }

  if (file.size > MAX_BANNER_BYTES) {
    throw new Error("Banner file too large (max 15MB).");
  }

  const sb = supabaseAdmin();
  const ext = extFromType(file.type);
  const path = `${wallet}/${targetDate}/${coinId}/banner.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const uploadRes = await sb.storage.from(BIDDING_AD_BANNER_BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: true
  });

  if (uploadRes.error) throw new Error(uploadRes.error.message);

  return path;
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

    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const signature = safeTrim(form.get("signature"));
    const targetDate = safeTrim(form.get("target_date")) || currentTargetDate();
    const coinId = safeTrim(form.get("coin_id"));
    const fileEntry = form.get("file");
    const bannerFile = fileEntry instanceof File ? fileEntry : null;

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    if (!coinId) {
      return NextResponse.json({ error: "coin_id is required" }, { status: 400 });
    }

    if (!bannerFile) {
      return NextResponse.json({ error: "A banner file is required" }, { status: 400 });
    }

    const auction = await getOrCreateAuction(targetDate);
    const now = new Date();
    const entryOpensAt = new Date(String(auction.entry_opens_at));
    const auctionStartsAt = new Date(String(auction.auction_starts_at));

    if (now < entryOpensAt) {
      return NextResponse.json({ error: "Bidding Ad entry is not open yet" }, { status: 400 });
    }

    if (now >= auctionStartsAt) {
      return NextResponse.json({ error: "Bidding Ad entry is closed for that day" }, { status: 400 });
    }

    const coin = await getOwnedCoin(wallet, coinId);
    if (!coin) {
      return NextResponse.json({ error: "Selected coin not found" }, { status: 400 });
    }

    const existingEntry = await getEntry(wallet, targetDate);
    if (existingEntry?.entry_payment_status === "paid") {
      return NextResponse.json({
        ok: true,
        entry_id: String(existingEntry.id),
        target_date: targetDate,
        already_paid: true
      });
    }

    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: "Server missing SOLANA_RPC_URL" }, { status: 500 });
    }

    const treasuryWallet = getTreasuryWallet();
    const requiredLamports = getEntryFeeLamports();

    const connection = new Connection(rpcUrl, "confirmed");
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });

    if (!tx || !tx.meta) {
      return NextResponse.json(
        { error: "Transaction not confirmed yet. Try again." },
        { status: 400 }
      );
    }

    const staticKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const payer = staticKeys[0]?.toBase58();

    if (!payer || payer !== wallet) {
      return NextResponse.json({ error: "Payer wallet mismatch" }, { status: 400 });
    }

    const treasuryKey = new PublicKey(treasuryWallet);
    const treasuryIndex = staticKeys.findIndex((k) => k.equals(treasuryKey));

    if (treasuryIndex === -1) {
      return NextResponse.json(
        { error: "Treasury wallet not involved in transaction" },
        { status: 400 }
      );
    }

    const preLamports = tx.meta.preBalances[treasuryIndex] ?? 0;
    const postLamports = tx.meta.postBalances[treasuryIndex] ?? 0;
    const deltaLamports = postLamports - preLamports;

    if (deltaLamports < requiredLamports) {
      return NextResponse.json(
        {
          error: `Entry fee too low. Received ${deltaLamports} lamports, expected at least ${requiredLamports}.`
        },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    const { data: existingSig, error: existingSigErr } = await sb
      .from("bidding_ad_entries")
      .select("id, entry_payment_signature")
      .eq("entry_payment_signature", signature)
      .maybeSingle();

    if (existingSigErr) {
      return NextResponse.json({ error: existingSigErr.message }, { status: 500 });
    }

    if (existingSig?.entry_payment_signature) {
      if (existingEntry && String(existingSig.id) === String(existingEntry.id)) {
        return NextResponse.json({
          ok: true,
          entry_id: String(existingEntry.id),
          target_date: targetDate,
          already_paid: true
        });
      }

      return NextResponse.json({ error: "Signature already used" }, { status: 400 });
    }

    const bannerPath = await uploadBiddingAdBanner(wallet, targetDate, String(coin.id), bannerFile);

    const paidAtIso = new Date().toISOString();

    const payload = {
      auction_id: auction.id,
      target_date: targetDate,
      dev_wallet: wallet,
      coin_id: coin.id,
      banner_path: bannerPath,
      coin_title: coin.title ?? null,
      token_address: coin.token_address ?? null,
      entry_fee_lamports: requiredLamports,
      entry_payment_status: "paid",
      entry_payment_signature: signature,
      entry_payment_confirmed_at: paidAtIso
    };

    const upsertRes = await sb
      .from("bidding_ad_entries")
      .upsert(payload, { onConflict: "target_date,dev_wallet" })
      .select(
        "id, auction_id, target_date, dev_wallet, coin_id, banner_path, coin_title, token_address, entry_fee_lamports, entry_payment_status, entry_payment_signature, entry_payment_confirmed_at, created_at, updated_at"
      )
      .single();

    if (upsertRes.error) {
      return NextResponse.json({ error: upsertRes.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      entry_id: String(upsertRes.data.id),
      target_date: targetDate,
      entry: upsertRes.data,
      payment: {
        signature,
        confirmed_at: paidAtIso,
        amount_lamports: requiredLamports,
        amount_sol: requiredLamports / 1_000_000_000
      }
    });
  } catch (e: any) {
    console.error("confirm-bidding-entry error:", e);

    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
