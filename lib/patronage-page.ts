import type { PoolView } from "@/lib/patronage-onchain";
import type { DistrictId } from "@/types/enums";

/**
 * Logika murni halaman /patronage (Dev Brief §8.1, sesi 4B): urutan, filter ward, batch "Claim all",
 * dan jumlah per 1.000 $WAGE. Sengaja bebas React/viem/Supabase supaya bisa diuji lewat
 * `npx tsx scripts/test-patronage-4b.ts`. `PoolView` diimpor sebagai tipe saja (terhapus saat build).
 */

export type PoolSortKey = "staked" | "wages7d";
export type WardFilter = "all" | DistrictId;

/** Batas bangunan per transaksi `claimMany`. Gas tumbuh linear per bangunan; kota ini ~20 bangunan,
 *  jadi batas ini hanya pagar pengaman bila daftar kelak membesar. Sisanya diklaim di tekanan berikutnya. */
export const MAX_CLAIM_BATCH = 30;

/** "123" / "123.0" / null -> bigint. Jumlah dari API berupa string base unit. */
export function parseBase(v: string | null | undefined): bigint {
  return BigInt((v ?? "0").split(".")[0] || "0");
}

const cmpDesc = (a: bigint, b: bigint) => (a === b ? 0 : a > b ? -1 : 1);

/** Menurun menurut kunci; seri -> nama, supaya urutan stabil antar-refresh (sama dengan API). */
export function sortPools(pools: readonly PoolView[], key: PoolSortKey): PoolView[] {
  const val = (p: PoolView) => parseBase(key === "wages7d" ? p.sealed7d : p.totalStaked);
  return [...pools].sort((a, b) => cmpDesc(val(a), val(b)) || a.name.localeCompare(b.name));
}

export function filterPools(pools: readonly PoolView[], ward: WardFilter): PoolView[] {
  return ward === "all" ? [...pools] : pools.filter((p) => p.ward === ward);
}

/**
 * Reward yang benar-benar dibagi ke patron 7 hari terakhir, per 1.000 $WAGE yang di-stake SEKARANG,
 * dalam base unit. null = tidak ada stake.
 *
 * Dihitung dari `paidToPatrons7d` dan `totalStaked`, dalam base unit. (Field lama `PoolView.cutPer1000Staked`
 * sudah dibuang: rumusnya `notified * 1000 / staked` menghasilkan jumlah $WAGE UTUH dan memotong pecahan,
 * jadi 0,5 WAGE per 1.000 tampil 0.)
 */
export function rewardPer1000(paid7d: string, totalStaked: string, decimals: number): bigint | null {
  const staked = parseBase(totalStaked);
  if (staked <= 0n) return null;
  return (parseBase(paid7d) * 1000n * 10n ** BigInt(decimals)) / staked;
}

export interface PositionRow {
  chainAgentId: `0x${string}`;
  staked: bigint;
  cooling: bigint;
  /** Detik epoch; 0 = tidak ada cooldown. */
  unlockAt: number;
  pending: bigint;
}

export interface PositionTotals {
  staked: bigint;
  cooling: bigint;
  pending: bigint;
  /** Bangunan dengan stake aktif. */
  stakedBuildings: number;
  /** Bangunan dengan reward menunggu. */
  claimableBuildings: number;
  /** Unlock paling awal di antara $WAGE yang cooldown (detik epoch); null = tidak ada. */
  nextUnlockAt: number | null;
}

export function sumPositions(rows: readonly PositionRow[]): PositionTotals {
  const t: PositionTotals = {
    staked: 0n,
    cooling: 0n,
    pending: 0n,
    stakedBuildings: 0,
    claimableBuildings: 0,
    nextUnlockAt: null,
  };
  for (const r of rows) {
    t.staked += r.staked;
    t.cooling += r.cooling;
    t.pending += r.pending;
    if (r.staked > 0n) t.stakedBuildings++;
    if (r.pending > 0n) t.claimableBuildings++;
    if (r.cooling > 0n && r.unlockAt > 0 && (t.nextUnlockAt === null || r.unlockAt < t.nextUnlockAt)) {
      t.nextUnlockAt = r.unlockAt;
    }
  }
  return t;
}

/** Baris yang layak ditampilkan di "Your position": ada stake, cooldown, atau reward menunggu. */
export const hasPosition = (r: PositionRow) => r.staked > 0n || r.cooling > 0n || r.pending > 0n;

export interface ClaimBatch {
  ids: `0x${string}`[];
  /** Jumlah pending yang terbaca saat ini untuk bangunan terpilih (angka kontrak bisa lebih besar setelahnya). */
  total: bigint;
  /** Bangunan dengan reward menunggu yang tidak ikut batch ini (melebihi `max`). */
  remaining: number;
}

/** Pilih bangunan untuk `claimMany`: hanya yang pending > 0, tanpa duplikat, terbesar dulu. */
export function selectClaimBatch(rows: readonly PositionRow[], max = MAX_CLAIM_BATCH): ClaimBatch {
  const seen = new Set<string>();
  const claimable = rows
    .filter((r) => r.pending > 0n)
    .filter((r) => {
      const k = r.chainAgentId.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => cmpDesc(a.pending, b.pending));
  const chosen = claimable.slice(0, max);
  return {
    ids: chosen.map((r) => r.chainAgentId),
    total: chosen.reduce((s, r) => s + r.pending, 0n),
    remaining: claimable.length - chosen.length,
  };
}

/** Gabungan id bangunan dari daftar pool dan dari posisi indexer, tanpa duplikat (huruf kecil). */
export function unionBuildingIds(
  ...lists: ReadonlyArray<ReadonlyArray<string>>
): `0x${string}`[] {
  const out: `0x${string}`[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const id of list) {
      const k = id.toLowerCase();
      if (!/^0x[0-9a-f]{64}$/.test(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(k as `0x${string}`);
    }
  }
  return out;
}
