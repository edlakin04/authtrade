"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TrustWalletAdapter,
  CoinbaseWalletAdapter
} from "@solana/wallet-adapter-wallets";

// ✅ THIS LINE RESTORES ORIGINAL WALLET UI + MODAL
import "@solana/wallet-adapter-react-ui/styles.css";

export default function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => {
    // Always use same-origin proxy to avoid browser CORS issues with RPC providers.
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/rpc`;
    }
    // During SSR/build: any placeholder is fine; it won't be used to send tx.
    return "http://localhost/api/rpc";
  }, []);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new TrustWalletAdapter(),
      new CoinbaseWalletAdapter()
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
