"use client";

import React, { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useRouter } from "next/navigation";

// ─── UpgradeModal ─────────────────────────────────────────────────────────────
// Shown to trial users who click "Subscribe" or try a blocked action.
// Skips wallet connect / sign-in — the user is already signed in.
// Now includes country selector for VAT tracking (internal use only —
// the customer sees a simple "where are you based?" question with no
// mention of tax).

type Props = {
  open:    boolean;
  onClose: () => void;
};

const ALL_COUNTRIES = [
  { code: "AF", name: "Afghanistan" }, { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" }, { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" }, { code: "AG", name: "Antigua and Barbuda" },
  { code: "AR", name: "Argentina" }, { code: "AM", name: "Armenia" },
  { code: "AU", name: "Australia" }, { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" }, { code: "BS", name: "Bahamas" },
  { code: "BH", name: "Bahrain" }, { code: "BD", name: "Bangladesh" },
  { code: "BB", name: "Barbados" }, { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" }, { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" }, { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia" }, { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" }, { code: "BR", name: "Brazil" },
  { code: "BN", name: "Brunei" }, { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" }, { code: "BI", name: "Burundi" },
  { code: "CV", name: "Cabo Verde" }, { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" }, { code: "CA", name: "Canada" },
  { code: "CF", name: "Central African Republic" }, { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" }, { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" }, { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo" }, { code: "CR", name: "Costa Rica" },
  { code: "HR", name: "Croatia" }, { code: "CU", name: "Cuba" },
  { code: "CY", name: "Cyprus" }, { code: "CZ", name: "Czech Republic" },
  { code: "DK", name: "Denmark" }, { code: "DJ", name: "Djibouti" },
  { code: "DO", name: "Dominican Republic" }, { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" }, { code: "SV", name: "El Salvador" },
  { code: "EE", name: "Estonia" }, { code: "ET", name: "Ethiopia" },
  { code: "FJ", name: "Fiji" }, { code: "FI", name: "Finland" },
  { code: "FR", name: "France" }, { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" }, { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" }, { code: "GH", name: "Ghana" },
  { code: "GR", name: "Greece" }, { code: "GT", name: "Guatemala" },
  { code: "GN", name: "Guinea" }, { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" }, { code: "HN", name: "Honduras" },
  { code: "HK", name: "Hong Kong" }, { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" }, { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" }, { code: "IQ", name: "Iraq" },
  { code: "IE", name: "Ireland" }, { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" }, { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" }, { code: "JO", name: "Jordan" },
  { code: "KZ", name: "Kazakhstan" }, { code: "KE", name: "Kenya" },
  { code: "KW", name: "Kuwait" }, { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Laos" }, { code: "LV", name: "Latvia" },
  { code: "LB", name: "Lebanon" }, { code: "LS", name: "Lesotho" },
  { code: "LR", name: "Liberia" }, { code: "LY", name: "Libya" },
  { code: "LI", name: "Liechtenstein" }, { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" }, { code: "MK", name: "North Macedonia" },
  { code: "MG", name: "Madagascar" }, { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" }, { code: "MV", name: "Maldives" },
  { code: "ML", name: "Mali" }, { code: "MT", name: "Malta" },
  { code: "MR", name: "Mauritania" }, { code: "MU", name: "Mauritius" },
  { code: "MX", name: "Mexico" }, { code: "MD", name: "Moldova" },
  { code: "MC", name: "Monaco" }, { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" }, { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" }, { code: "MM", name: "Myanmar" },
  { code: "NA", name: "Namibia" }, { code: "NP", name: "Nepal" },
  { code: "NL", name: "Netherlands" }, { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" }, { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" }, { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman" }, { code: "PK", name: "Pakistan" },
  { code: "PA", name: "Panama" }, { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" }, { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" }, { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" }, { code: "QA", name: "Qatar" },
  { code: "RO", name: "Romania" }, { code: "RU", name: "Russia" },
  { code: "RW", name: "Rwanda" }, { code: "SA", name: "Saudi Arabia" },
  { code: "SN", name: "Senegal" }, { code: "RS", name: "Serbia" },
  { code: "SL", name: "Sierra Leone" }, { code: "SG", name: "Singapore" },
  { code: "SK", name: "Slovakia" }, { code: "SI", name: "Slovenia" },
  { code: "SO", name: "Somalia" }, { code: "ZA", name: "South Africa" },
  { code: "KR", name: "South Korea" }, { code: "SS", name: "South Sudan" },
  { code: "ES", name: "Spain" }, { code: "LK", name: "Sri Lanka" },
  { code: "SD", name: "Sudan" }, { code: "SR", name: "Suriname" },
  { code: "SE", name: "Sweden" }, { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syria" }, { code: "TW", name: "Taiwan" },
  { code: "TJ", name: "Tajikistan" }, { code: "TZ", name: "Tanzania" },
  { code: "TH", name: "Thailand" }, { code: "TL", name: "Timor-Leste" },
  { code: "TG", name: "Togo" }, { code: "TT", name: "Trinidad and Tobago" },
  { code: "TN", name: "Tunisia" }, { code: "TR", name: "Turkey" },
  { code: "TM", name: "Turkmenistan" }, { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" }, { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" }, { code: "US", name: "United States" },
  { code: "UY", name: "Uruguay" }, { code: "UZ", name: "Uzbekistan" },
  { code: "VE", name: "Venezuela" }, { code: "VN", name: "Vietnam" },
  { code: "YE", name: "Yemen" }, { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
].sort((a, b) => a.name.localeCompare(b.name));

const BLOCKED_CODES = new Set(["RU", "BY"]);

export default function UpgradeModal({ open, onClose }: Props) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [loading,         setLoading]         = useState(false);
  const [err,             setErr]             = useState<string | null>(null);
  const [confirming,      setConfirming]      = useState(false);
  const [geoLoading,      setGeoLoading]      = useState(false);
  const [ipCountry,       setIpCountry]       = useState<string | null>(null);
  const [declaredCountry, setDeclaredCountry] = useState<string>("");
  const [countryMismatch, setCountryMismatch] = useState(false);
  const [isBlocked,       setIsBlocked]       = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setGeoLoading(true);
      try {
        const res  = await fetch("/api/vat/lookup", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (json?.detected?.countryCode) {
          const code = json.detected.countryCode as string;
          setIpCountry(code);
          setDeclaredCountry(code);
          setIsBlocked(json.blocked ?? BLOCKED_CODES.has(code));
        }
      } catch { /* silent */ } finally {
        if (!cancelled) setGeoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!ipCountry || !declaredCountry) { setCountryMismatch(false); return; }
    setCountryMismatch(ipCountry !== declaredCountry && !BLOCKED_CODES.has(declaredCountry));
    setIsBlocked(BLOCKED_CODES.has(declaredCountry));
  }, [ipCountry, declaredCountry]);

  if (!open) return null;

  const priceSol = Number(process.env.NEXT_PUBLIC_SUB_PRICE_SOL ?? "0");
  const treasury = process.env.NEXT_PUBLIC_TREASURY_WALLET ?? "";

  async function handleSubscribe() {
    if (isBlocked) { setErr("This service is not available in your region."); return; }
    if (!declaredCountry) { setErr("Please select your country before subscribing."); return; }
    if (!publicKey) { setErr("Wallet not connected."); return; }
    if (!sendTransaction) { setErr("This wallet cannot send transactions."); return; }
    if (!treasury) { setErr("Missing treasury wallet config."); return; }
    if (!Number.isFinite(priceSol) || priceSol <= 0) { setErr("Missing subscription price config."); return; }

    setErr(null);
    setLoading(true);

    try {
      const toPubkey = new PublicKey(treasury);
      const lamports = Math.round(priceSol * 1_000_000_000);
      const latest   = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, recentBlockhash: latest.blockhash })
        .add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey, lamports }));

      const sig = await sendTransaction(tx, connection);
      setLoading(false);
      setConfirming(true);

      let lastErr: any = null;
      for (let i = 0; i < 12; i++) {
        const res = await fetch("/api/payments/confirm-subscription", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            signature:        sig,
            declared_country: declaredCountry,
            ip_country:       ipCountry,
          }),
        });
        if (res.ok) {
          await fetch("/api/context/refresh", { method: "POST" });
          onClose();
          window.location.href = "/dashboard";
          return;
        }
        lastErr = await res.json().catch(() => ({}));
        await new Promise((r) => setTimeout(r, 1200));
      }
      setConfirming(false);
      setErr(lastErr?.error ?? "Payment sent but verification timed out. Wait 10s and refresh.");
    } catch (e: any) {
      setLoading(false);
      setConfirming(false);
      const msg = e?.message || e?.toString?.() || "Payment failed.";
      if (!msg.toLowerCase().includes("reject") && !msg.toLowerCase().includes("cancel")) setErr(msg);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">
              {confirming ? "Confirming payment…" : "Upgrade to full access"}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {confirming ? "Your transaction was sent. Waiting for confirmation." : "Your free trial doesn't include this feature."}
            </p>
          </div>
          {!loading && !confirming && (
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-white">✕</button>
          )}
        </div>

        {confirming && (
          <div className="mt-6 flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="text-xs text-zinc-500">This usually takes a few seconds…</p>
          </div>
        )}

        {!confirming && (
          <>
            {isBlocked ? (
              <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-sm text-red-300 font-medium">Service unavailable</p>
                <p className="mt-1 text-xs text-red-300/70">Authswap is not available in your region.</p>
              </div>
            ) : (
              <>
                <div className="mt-5">
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">
                    Where are you based?
                  </label>
                  <select
                    value={declaredCountry}
                    onChange={(e) => setDeclaredCountry(e.target.value)}
                    disabled={geoLoading || loading}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 disabled:opacity-60"
                  >
                    <option value="">{geoLoading ? "Detecting location…" : "Select your country"}</option>
                    {ALL_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                  {countryMismatch && declaredCountry && (
                    <p className="mt-2 text-xs text-amber-400">
                      ⚠ Your location appears different from your selection — please make sure your country is correct.
                    </p>
                  )}
                </div>

                <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">Full access unlocks</p>
                  <ul className="space-y-2">
                    {["Dashboard & following feed","Join & post in communities","Comment & upvote coins","Vote on polls","Follow devs & leave reviews","Jupiter swap inside Authswap"].map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-zinc-300">
                        <span className="text-emerald-400 text-xs">✓</span>{f}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                  <div className="flex items-center justify-between text-emerald-200">
                    <span className="text-sm font-semibold">Monthly subscription</span>
                    <span className="text-lg font-bold">{priceSol} SOL</span>
                  </div>
                  <p className="mt-1 text-xs text-emerald-200/70">30 days full access. Sends SOL to Authswap treasury.</p>
                  <button
                    className="mt-4 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-60 transition"
                    disabled={loading || !declaredCountry || geoLoading}
                    onClick={handleSubscribe}
                  >
                    {loading ? "Opening wallet…" : `Subscribe — ${priceSol} SOL`}
                  </button>
                </div>
              </>
            )}
            {err && <p className="mt-3 text-xs text-red-400 text-center">{err}</p>}
          </>
        )}
      </div>
    </div>
  );
}
