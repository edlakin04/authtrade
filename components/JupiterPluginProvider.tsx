"use client";

import Script from "next/script";

export default function JupiterPluginProvider() {
  // Loads window.Jupiter
  return (
    <Script
      src="https://plugin.jup.ag/plugin-v1.js"
      strategy="afterInteractive"
    />
  );
}
