/**
 * Hitungan supply murni (tanpa RPC / Supabase) supaya bisa diuji:
 *   npx tsx scripts/test-patronage-4c.ts
 *
 * Semua jumlah bigint dalam base unit. Dipakai `takeSupplySnapshot()` (supply.ts).
 */

export interface SupplyBalances {
  total: bigint;
  burned: bigint;
  curve: bigint;
  /** null = pool tidak terlacak; dihitung 0 untuk Circulating, tetapi kolom `lp` di snapshot tetap null. */
  lp: bigint | null;
  locker: bigint;
  /** Strongbox v1 + v2. */
  strongbox: bigint;
  /** Splitter v1 + v2. */
  splitter: bigint;
  /** Lamp Oil + Tithe. */
  treasuries: bigint;
  /** Saldo kontrak WageholdPatronage: stake aktif + cooldown + reward belum diklaim. */
  patronage: bigint;
}

/** Circulating = sisa setelah semua bucket yang bukan beredar bebas dikurangi. */
export function circulatingSupply(b: SupplyBalances): bigint {
  return b.total - b.burned - b.curve - b.locker - (b.lp ?? 0n) - b.strongbox - b.splitter - b.treasuries - b.patronage;
}

/** Jumlah semua bucket yang tampil (dipakai penjaga "sum gap" di halaman: harus == total). */
export function bucketSum(b: SupplyBalances, circulating: bigint): bigint {
  return b.burned + b.curve + (b.lp ?? 0n) + b.locker + b.strongbox + b.splitter + b.treasuries + b.patronage + circulating;
}
