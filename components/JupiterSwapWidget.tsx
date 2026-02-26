"use client";

import React, { useEffect, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

declare global {
  interface Window {
    Jupiter?: {
      init: (props: any) => void;
      close: () => void;
      resume: () => void;
      syncProps: (props: any) => void;
    };
  }
}

export default function JupiterSwapWidget({
  inputMint,
  outputMint
}: {
  inputMint?: string;
  outputMint?: string;
}) {
  const wallet = useWallet();

  const referralAccount = process.env.NEXT_PUBLIC_JUP_REFERRAL_ACCOUNT;
  const referralFee = Number(process.env.NEXT_PUBLIC_JUP_REFERRAL_FEE_BPS || "0");

  const formProps = useMemo(() => {
    return {
      swapMode: "ExactInOrOut",
      initialInputMint: inputMint || undefined,
      initialOutputMint: outputMint || undefined,
      referralAccount: referralAccount || undefined,
      referralFee: Number.isFinite(referralFee) ? referralFee : 0
    };
  }, [inputMint, outputMint, referralAccount, referralFee]);

  useEffect(() => {
    // Wait until the plugin script has loaded
    if (!window.Jupiter) return;

    window.Jupiter.init({
      displayMode: "integrated",
      integratedTargetId: "jupiter-plugin",
      enableWalletPassthrough: true,
      passthroughWalletContextState: wallet,
      onRequestConnectWallet: () => {
        // Your wallet modal already handles connect; just trigger connect.
        wallet.connect?.();
      },
      formProps,
      containerClassName: "jup-wrap"
    });

    // keep plugin synced if wallet state changes
    window.Jupiter.syncProps({ passthroughWalletContextState: wallet });

    return () => {
      // avoid leaving it mounted weirdly between pages
      try {
        window.Jupiter?.close?.();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.publicKey?.toBase58(), formProps]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 text-sm text-zinc-300">
        Powered by Jupiter Plugin (embedded)
      </div>

      <div id="jupiter-plugin" className="min-h-[520px] w-full" />

      <style jsx global>{`
        /* Small safety net for layout */
        .jup-wrap {
          width: 100%;
        }
      `}</style>
    </div>
  );
}
