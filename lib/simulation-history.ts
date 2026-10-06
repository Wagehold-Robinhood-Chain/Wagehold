/**
 * "Simulation history" di profil bangunan (Dev Brief §7.2, sesi 4D): ringkasan stake SIMULASI yang dibekukan
 * saat cut-over (tabel `stakes`, 0013, dibekukan 0020). Murni, tanpa Supabase, supaya bisa diuji.
 *
 * Ini BUKAN posisi on-chain. Angka on-chain ada di panel Patronage dan indexer (`building_pools`).
 */
export interface SimStakeRow {
  staker_id: string;
  amount: number | string;
  earned: number | string;
}

export interface SimulationSummary {
  /** Patron simulasi dengan stake > 0 saat dibekukan. */
  patrons: number;
  /** Total stake simulasi saat dibekukan. */
  staked: number;
  /** Total bagian patron simulasi yang pernah dibagikan di bangunan ini (termasuk yang sudah menarik stake). */
  earned: number;
  /** Baris milik pengunjung (`stakes.staker_id` = identitas browser / wallet), null bila tidak ada. */
  mine: { staked: number; earned: number } | null;
}

export function summarizeSimulation(rows: readonly SimStakeRow[], viewerId: string | null): SimulationSummary {
  let patrons = 0;
  let staked = 0;
  let earned = 0;
  let mine: SimulationSummary["mine"] = null;
  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    const e = Number(r.earned) || 0;
    if (amount > 0) {
      patrons += 1;
      staked += amount;
    }
    earned += e;
    if (viewerId && r.staker_id === viewerId && (amount > 0 || e > 0)) mine = { staked: amount, earned: e };
  }
  return { patrons, staked, earned, mine };
}

/** Tampilkan bagian ini hanya bila bangunan ini pernah punya sesuatu di simulasi. */
export function hasSimulationHistory(s: SimulationSummary): boolean {
  return s.staked > 0 || s.earned > 0 || s.mine !== null;
}
