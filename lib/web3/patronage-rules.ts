import { formatWageUnits } from "@/lib/wage-format";

/**
 * Pengecekan sisi klien yang mencerminkan aturan WageholdPatronage, dijalankan SEBELUM wallet
 * diminta menandatangani apa pun. Kontrak tetap sumber kebenaran: ini hanya supaya user tidak
 * membayar gas untuk transaksi yang pasti revert (dan pesannya bisa dibaca manusia).
 * Bebas viem/wagmi supaya bisa diuji tanpa browser.
 */

export interface StakeCheckInput {
  amount: bigint;
  /** Saldo $WAGE wallet. */
  balance: bigint;
  /** Stake aktif user di bangunan ini. */
  staked: bigint;
  minStake: bigint;
  /** 0 = tanpa batas. */
  maxStakePerUser: bigint;
  registered: boolean;
  paused: boolean;
  decimals: number;
}

/** null = boleh lanjut; string = alasan yang ditampilkan ke user. */
export function checkStake(i: StakeCheckInput): string | null {
  if (!i.registered) return "This building isn't open for patronage yet.";
  if (i.paused) return "New stakes are paused. You can still claim, request unstake and withdraw.";
  if (i.amount <= 0n) return "Enter an amount greater than 0.";
  if (i.amount < i.minStake) {
    return `The minimum stake is ${formatWageUnits(i.minStake, { decimals: i.decimals, maxFraction: 4 })}.`;
  }
  if (i.maxStakePerUser > 0n && i.staked + i.amount > i.maxStakePerUser) {
    const room = i.maxStakePerUser > i.staked ? i.maxStakePerUser - i.staked : 0n;
    return `A patron can stake at most ${formatWageUnits(i.maxStakePerUser, { decimals: i.decimals, maxFraction: 4 })} per building. You can add ${formatWageUnits(room, { decimals: i.decimals, maxFraction: 4 })} more.`;
  }
  if (i.amount > i.balance) {
    return `Your wallet has ${formatWageUnits(i.balance, { decimals: i.decimals, maxFraction: 4 })}, less than the amount entered.`;
  }
  return null;
}

export function checkUnstake(i: { amount: bigint; staked: bigint; decimals: number }): string | null {
  if (i.amount <= 0n) return "Enter an amount greater than 0.";
  if (i.amount > i.staked) {
    return `You have ${formatWageUnits(i.staked, { decimals: i.decimals, maxFraction: 4 })} staked here.`;
  }
  return null;
}

/** Jumlah terbesar yang bisa di-stake sekarang (min saldo, sisa kuota per patron). */
export function maxStakeable(balance: bigint, staked: bigint, maxStakePerUser: bigint): bigint {
  if (maxStakePerUser === 0n) return balance;
  const room = maxStakePerUser > staked ? maxStakePerUser - staked : 0n;
  return balance < room ? balance : room;
}

/** Detik tersisa sampai `unlockAt` (detik epoch), 0 kalau sudah lewat. */
export function cooldownRemaining(unlockAtSec: bigint | number, nowMs: number): number {
  const left = Number(unlockAtSec) - Math.floor(nowMs / 1000);
  return left > 0 ? left : 0;
}

/** 273600 -> "3d 4h", 4500 -> "1h 15m", 90 -> "2m", 20 -> "under a minute". Menit dibulatkan ke atas. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const totalMin = Math.ceil(seconds / 60);
  const d = Math.floor(totalMin / 1_440);
  const h = Math.floor((totalMin % 1_440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Cooldown kontrak (detik) untuk kalimat: 259200 -> "3 days". */
export function describeCooldown(seconds: number): string {
  const days = seconds / 86_400;
  if (Number.isInteger(days)) return `${days} ${days === 1 ? "day" : "days"}`;
  const hours = seconds / 3_600;
  return Number.isInteger(hours) ? `${hours} ${hours === 1 ? "hour" : "hours"}` : formatDuration(seconds);
}
