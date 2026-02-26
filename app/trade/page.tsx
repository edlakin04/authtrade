import React, { Suspense } from "react";
import TradeInner from "./trade-inner";

export default function TradePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-authswap text-white p-10">Loading…</div>}>
      <TradeInner />
    </Suspense>
  );
}
