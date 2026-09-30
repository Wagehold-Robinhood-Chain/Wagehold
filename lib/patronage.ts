import { WAGE_UNIT } from '@/lib/currency';

/**
 * Patronage (Revision 1): patron men-stake $WAGE pada sebuah bangunan dan berbagi
 * porsi patron-nya (60% dari tiap wage yang disegel) pro rata terhadap stake.
 *
 * MODE SIMULASI: stake hanyalah catatan di Postgres (tabel `stakes`), tidak ada
 * token yang bergerak dan tidak ada saldo yang dicek. Staking on-chain belum ada.
 */

/** Batas per satu aksi stake/unstake -- penjaga input, bukan aturan ekonomi. */
export const MAX_STAKE_PER_ACTION = 1_000_000;
/** Batas stake satu patron pada satu bangunan (simulasi). */
export const MAX_STAKE_PER_BUILDING = 5_000_000;

export interface StakeItem {
  stakerId: string;
  agentId: string;
  amount: number;
  earned: number;
}

export interface PatronageSummary {
  stakedWage: number;
  stakerCount: number;
  myStake: number;
  myEarned: number;
  /** Persentase pool milik user (0-100), 0 kalau tidak ada stake. */
  mySharePct: number;
}

/** Ringkasan Patronage satu bangunan dari daftar stake. `userId` boleh null. */
export function summarizeStakes(
  stakes: StakeItem[],
  agentId: string,
  userId: string | null,
): PatronageSummary {
  let stakedWage = 0;
  let stakerCount = 0;
  let myStake = 0;
  let myEarned = 0;
  for (const s of stakes) {
    if (s.agentId !== agentId) continue;
    if (s.amount > 0) {
      stakedWage += s.amount;
      stakerCount += 1;
    }
    if (userId && s.stakerId === userId) {
      myStake = s.amount;
      myEarned = s.earned;
    }
  }
  return {
    stakedWage,
    stakerCount,
    myStake,
    myEarned,
    mySharePct: stakedWage > 0 ? (myStake / stakedWage) * 100 : 0,
  };
}

/** "1,844 WAGE" -- sampai 2 desimal, tanpa nol di belakang (hasil bagi pro rata bisa pecahan). */
export function formatWage(n: number): string {
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${WAGE_UNIT}`;
}
