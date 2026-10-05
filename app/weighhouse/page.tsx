import type { Metadata } from "next";
import { WeighhouseClient } from "@/components/weighhouse/weighhouse-client";
import { getLedger, getPriceSeries, getSummary, getTopBuildings } from "@/lib/weighhouse/metrics";

export const metadata: Metadata = {
  title: "The Weighhouse · Wagehold",
  description: "Every $WAGE, weighed: supply, utility, burn and the Work Ratio, each number linked to Blockscout.",
};

// Dibaca dari tabel snapshot (tanpa RPC di jalur request). Segarkan tiap 30 dtk.
export const revalidate = 30;

/** Tabel belum dimigrasi / Supabase belum siap -> halaman tetap render dengan empty state. */
const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
  try { return await p; } catch { return fallback; }
};

export default async function WeighhousePage() {
  const [summary, ledger, top, price] = await Promise.all([
    safe(getSummary("7d"), null),
    safe(getLedger(50), []),
    safe(getTopBuildings("7d"), []),
    safe(getPriceSeries("7d"), null),
  ]);
  return <WeighhouseClient initialSummary={summary} initialLedger={ledger} initialTop={top} initialPrice={price} />;
}
