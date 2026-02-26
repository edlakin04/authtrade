import "./globals.css";
import type { Metadata } from "next";
import Providers from "./providers";
import JupiterPluginProvider from "@/components/JupiterPluginProvider";

export const metadata: Metadata = {
  title: "Authswap",
  description: "Private memecoin intelligence & trading platform"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-authswap text-white">
        {/* Solana Wallet Providers */}
        <Providers>
          {/* Jupiter Plugin Script Loader */}
          <JupiterPluginProvider />

          {/* App Content */}
          {children}
        </Providers>
      </body>
    </html>
  );
}
