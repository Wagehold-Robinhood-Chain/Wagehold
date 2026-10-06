import { BaseError, isAddress, keccak256, toBytes } from "viem";
import { patronageAbi } from "@/lib/web3/patronage-abi";
import { formatDuration } from "@/lib/web3/patronage-rules";

export { patronageAbi };

/**
 * Sesi 4A -- fondasi web3 Patronage (Dev Brief §8.2).
 *
 * ABI minimal: hanya fungsi yang dipanggil app + custom error yang bisa muncul dari wallet
 * call, supaya viem bisa menerjemahkannya jadi pesan yang terbaca. Sumber kebenaran tetap
 * `contracts/src/WageholdPatronage.sol`; `scripts/patronage-verify-abi.ts` membandingkan
 * keduanya (jalankan setiap kali kontrak berubah).
 */

function toAddress(value: string | undefined): `0x${string}` | undefined {
  if (!value) return undefined;
  return isAddress(value) ? value : undefined;
}

/**
 * Alamat WageholdPatronage untuk BROWSER. Harus sama dengan WEIGHHOUSE_PATRONAGE_ADDRESS yang
 * dipakai indexer server (env server tidak terbaca di browser, jadi dua variabel). Kosong =
 * panel Patronage menampilkan "belum aktif" -- tidak ada error, aplikasi lain tetap jalan.
 * Referensi `process.env.NEXT_PUBLIC_*` harus literal agar Next menanamkannya ke bundle.
 */
export const patronageAddress = toAddress(process.env.NEXT_PUBLIC_PATRONAGE_ADDRESS);
export const isPatronageConfigured = !!patronageAddress;

/** agentId on-chain = keccak256(bytes(agents.id)). Rumus yang sama dengan computeJobId()
 *  (strongbox.ts) dan scripts/patronage-backfill-agent-ids.ts / kolom agents.chain_agent_id. */
export function computeChainAgentId(agentUuid: string): `0x${string}` {
  return keccak256(toBytes(agentUuid));
}

/** Struktur pool/posisi tidak ada di ABI di atas dengan sengaja: angka yang dipakai UI
 *  (stake, cooldown, pending) tersedia lewat view scalar, sehingga tidak bergantung pada
 *  urutan field struct. 4B memakai API indexer untuk daftar & total. */

// ---------------------------------------------------------------------------------------------
// Pesan error yang terbaca manusia
// ---------------------------------------------------------------------------------------------

function isUserRejection(err: unknown): boolean {
  const e = err as { name?: string; code?: number; shortMessage?: string; message?: string };
  return (
    e?.name === "UserRejectedRequestError" ||
    e?.code === 4001 ||
    /user rejected|rejected the request|user denied/i.test(`${e?.shortMessage ?? ""} ${e?.message ?? ""}`)
  );
}

/** Dilempar sendiri oleh hook sebelum wallet diminta tanda tangan (cek lokal yang gagal). */
export class PatronageUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatronageUserError";
  }
}

const REVERT_MESSAGE: Record<string, string> = {
  ZeroAmount: "Enter an amount greater than 0.",
  BuildingNotRegistered: "This building isn't open for patronage yet.",
  BelowMinStake: "That is below the minimum stake.",
  ExceedsMaxStake: "That would go over the per-building stake limit.",
  InsufficientStake: "You don't have that much staked here.",
  NothingToWithdraw: "Nothing is waiting to be withdrawn.",
  NothingToClaim: "There are no patron rewards to claim yet.",
  EnforcedPause: "New stakes are paused. You can still claim, request unstake and withdraw.",
  // error bawaan token ERC-20 (OpenZeppelin v5) yang bisa muncul dari transferFrom
  ERC20InsufficientBalance: "Your wallet doesn't hold enough $WAGE for that.",
  ERC20InsufficientAllowance: "The $WAGE allowance is too low. Try again to approve it first.",
};

/** Ubah error apa pun dari viem/wagmi/wallet jadi satu kalimat untuk UI. */
export function describePatronageError(err: unknown): string {
  if (err instanceof PatronageUserError) return err.message;
  if (isUserRejection(err)) {
    return "You rejected the request in your wallet. Nothing was sent.";
  }

  if (err instanceof BaseError) {
    const revert = err.walk(
      (e) => typeof (e as { data?: { errorName?: unknown } }).data?.errorName === "string",
    ) as { data?: { errorName: string; args?: readonly unknown[] } } | null;

    const name = revert?.data?.errorName;
    if (name === "StillCoolingDown") {
      const unlockAt = Number(revert?.data?.args?.[0] ?? 0);
      const left = unlockAt - Math.floor(Date.now() / 1000);
      return left > 0
        ? `Still cooling down: ${formatDuration(left)} left before you can withdraw.`
        : "Still cooling down. Try again in a moment.";
    }
    if (name && REVERT_MESSAGE[name]) return REVERT_MESSAGE[name];
    if (name) return `The contract refused the transaction (${name}).`;
    if (/insufficient funds/i.test(err.shortMessage + err.message)) {
      return "Your wallet doesn't have enough ETH to pay for gas.";
    }
    return err.shortMessage || "The transaction failed.";
  }

  return err instanceof Error && err.message ? err.message : "Something went wrong.";
}
