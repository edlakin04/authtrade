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

const WSOL_MINT = "So11111111111111111111111111111111111111112";

export default function JupiterSwapWidget({
  inputMint,
  outputMint
}: {
  inputMint?: string;
  outputMint?: string;
}) {
  const wallet = useWallet();

  const formProps = useMemo(() => {
    return {
      swapMode: "ExactInOrOut",
      initialInputMint: inputMint || WSOL_MINT,
      initialOutputMint: outputMint || undefined
    };
  }, [inputMint, outputMint]);

  useEffect(() => {
    if (!window.Jupiter) return;

    window.Jupiter.init({
      displayMode: "integrated",
      integratedTargetId: "jupiter-plugin",
      enableWalletPassthrough: true,
      passthroughWalletContextState: wallet,
      onRequestConnectWallet: () => {
        wallet.connect?.();
      },
      formProps,
      containerClassName: "jup-wrap"
    });

    window.Jupiter.syncProps({ passthroughWalletContextState: wallet });

    return () => {
      try {
        window.Jupiter?.close?.();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.publicKey?.toBase58(), formProps]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 text-sm text-zinc-300">Powered by Jupiter Plugin (embedded)</div>

      <div id="jupiter-plugin" className="min-h-[520px] w-full" />

      <style jsx global>{`
        .jup-wrap {
          width: 100%;
        }
      `}</style>
    </div>
  );
}
