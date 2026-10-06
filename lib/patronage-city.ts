/**
 * Logika murni sesi 4C (Dev Brief §8.3): cincin emas patron di kota dan label ledger Patronage.
 * Bebas React / viem / Supabase supaya bisa diuji lewat `npx tsx scripts/test-patronage-4c.ts`.
 */

/** Hasil baca `stakeOf` satu bangunan. `staked === null` = pembacaan gagal (RPC), bukan "0". */
export interface StakeRead {
  /** agents.id (uuid) */
  agentId: string;
  staked: bigint | null;
}

/**
 * Himpunan bangunan yang ditandai cincin emas: wallet punya stake aktif (> 0) di sana.
 *
 * Pembacaan yang GAGAL mempertahankan status sebelumnya (`prev`), supaya satu RPC yang tersendat
 * tidak membuat cincin berkedip hilang lalu muncul lagi. Bangunan yang tidak lagi ada di `reads`
 * (mis. dihapus dari kota) otomatis gugur.
 */
export function patronBuildingIds(reads: readonly StakeRead[], prev: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  for (const r of reads) {
    if (r.staked === null) {
      if (prev.has(r.agentId)) out.add(r.agentId);
    } else if (r.staked > 0n) {
      out.add(r.agentId);
    }
  }
  return out;
}

/** Dua himpunan berisi elemen sama? (hindari render ulang tiap polling bila tidak ada perubahan). */
export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Penerjemah `numeric::text` base unit -> WAGE utuh (number), untuk TAMPILAN saja. */
export function baseToWage(v: string | number | null | undefined, decimals = 18): number {
  const s = String(v ?? "0").split(".")[0] || "0";
  const b = BigInt(/^-?\d+$/.test(s) ? s : "0");
  const unit = 10n ** BigInt(decimals);
  return Number(b / unit) + Number(b % unit) / Number(unit);
}

export type PatronageLedgerKind = "Staked" | "Patron reward" | "Redirected";

/** Penjelasan singkat (tooltip) tiap baris ledger Patronage. Tanpa kosakata produk keuangan (§10). */
export const PATRONAGE_LEDGER_HINT: Record<PatronageLedgerKind, string> = {
  Staked: "A patron staked $WAGE behind this building.",
  "Patron reward": "The patrons' share of a sealed wage, shared among everyone staked in this building.",
  Redirected: "No patron was staked when this wage was sealed, so the patrons' share went to the treasury.",
};

export function ledgerHint(kind: string): string | undefined {
  return (PATRONAGE_LEDGER_HINT as Record<string, string>)[kind];
}

/** Alamat dipendekkan untuk kalimat ledger: 0x1234…abcd. */
export function shortWallet(a: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * Kalimat ledger Patronage (Dev Brief §8.3). `amountText` sudah diformat lengkap dengan satuan ("5,000 WAGE").
 * Jenis lain (Sealed, Burned, dst.) tidak punya kalimat: mengembalikan null.
 *   Staked        -> "0x1234…abcd staked 5,000 WAGE on Deepdive"
 *   Patron reward -> "240 WAGE shared with Deepdive's patrons"
 *   Redirected    -> "No patrons on Gas Oracle. 60 WAGE routed to the treasury"
 * Bangunan atau wallet yang tidak terpetakan diganti kata netral, bukan dikosongkan.
 */
export function ledgerSentence(row: {
  kind: string;
  amountText: string | null;
  building: { name: string } | null;
  wallet?: string | null;
}): string | null {
  const name = row.building?.name ?? "a building";
  const amt = row.amountText ?? "—";
  switch (row.kind) {
    case "Staked":
      return `${row.wallet ? shortWallet(row.wallet) : "A patron"} staked ${amt} on ${name}`;
    case "Patron reward":
      return `${amt} shared with ${row.building ? `${name}'s` : "the building's"} patrons`;
    case "Redirected":
      return `No patrons on ${name}. ${amt} routed to the treasury`;
    default:
      return null;
  }
}
