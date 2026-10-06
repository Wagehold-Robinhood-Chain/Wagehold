import { baseToWage } from "@/lib/patronage-city";

/**
 * Counting House (Dev Brief §7.2, sesi 4D): tithe + bagian patron yang dialihkan ke treasury karena bangunan
 * tanpa staker. Sejak cut-over sumbernya event on-chain (SQL `counting_house_totals`, 0020), bukan `wage_splits`.
 * File ini murni (tanpa Supabase/viem) supaya bisa diuji dan dipakai server maupun client.
 */
export interface CountingHouse {
  /** Σ JobSplit.titheAmount (Splitter v1 + v2), WAGE utuh untuk tampilan. */
  tithe: number;
  /** Σ RewardRedirected.amount (bangunan tanpa staker), WAGE utuh. */
  redirected: number;
  /** tithe + redirected. */
  total: number;
}

/** Hasil `counting_house_totals()` (string base unit, 18 desimal) -> angka tampilan. Bentuk tak dikenal -> null-safe 0. */
export function parseCountingHouse(raw: unknown): CountingHouse {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tithe = baseToWage(o.tithe as string | undefined);
  const redirected = baseToWage(o.redirected as string | undefined);
  // `total` dari SQL dihitung dalam bigint (tanpa pembulatan float); kalau hilang, jumlahkan.
  const total = o.total === undefined ? tithe + redirected : baseToWage(o.total as string);
  return { tithe, redirected, total };
}
