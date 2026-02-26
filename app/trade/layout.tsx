import React from "react";
import Script from "next/script";

export default function TradeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://plugin.jup.ag/plugin-v1.js" strategy="afterInteractive" />
      {children}
    </>
  );
}
