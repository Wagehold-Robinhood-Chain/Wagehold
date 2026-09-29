import { keccak256, toBytes } from "viem";

/**
 * Bukti kepemilikan wallet untuk aksi off-chain (tanpa login / sesi).
 *
 * Di mode wallet, pemilik job = alamat yang mengunci wage di Strongbox. Aksi yang
 * tidak lewat transaksi (Send back) dan pencatatan seal (rating) harus dibuktikan
 * lewat tanda tangan pesan ini -- server membangun ulang pesan yang sama persis,
 * lalu memverifikasi tanda tangannya. Tanda tangan ini tidak memindahkan dana.
 *
 * File ini dipakai di browser (menandatangani) dan server (memverifikasi), jadi
 * harus tetap bebas dari API browser-only / server-only.
 */
export type WalletAction = "seal" | "revise";

export interface WalletAuth {
  address: `0x${string}`;
  /** ISO timestamp saat pesan ditandatangani -- dibatasi umurnya di server. */
  issuedAt: string;
  signature: `0x${string}`;
}

/** Cukup longgar untuk menunggu konfirmasi transaksi seal di wallet. */
export const WALLET_AUTH_MAX_AGE_MS = 15 * 60 * 1000;

/** Rating ikut ditandatangani supaya tidak bisa diganti orang lain di tengah jalan. */
export function sealDetail(rating?: number): string {
  return `rating=${rating ?? "none"}`;
}

/** Catatan Send back ditandatangani lewat hash-nya (pesan tetap pendek). */
export function reviseDetail(note: string): string {
  return `note=${keccak256(toBytes(note))}`;
}

export function buildAuthMessage(p: {
  action: WalletAction;
  jobId: string;
  detail: string;
  issuedAt: string;
}): string {
  return [
    "Wagehold",
    "",
    `Action: ${p.action}`,
    `Job: ${p.jobId}`,
    `Detail: ${p.detail}`,
    `Issued: ${p.issuedAt}`,
    "",
    "Signing proves you control this wallet. It does not move any funds.",
  ].join("\n");
}
