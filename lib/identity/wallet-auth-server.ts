import { isAddress } from "viem";
import { publicClient } from "@/lib/web3/public-client";
import {
  buildAuthMessage,
  WALLET_AUTH_MAX_AGE_MS,
  type WalletAction,
} from "@/lib/identity/wallet-auth";

const SIGNATURE_RE = /^0x[0-9a-fA-F]+$/;

/**
 * Server: memverifikasi tanda tangan wallet untuk satu aksi pada satu job.
 * Mengembalikan alamat (lowercase) yang terbukti menandatangani, atau melempar
 * Error dengan pesan yang aman ditampilkan ke user.
 *
 * `publicClient.verifyMessage` juga menangani wallet kontrak (ERC-1271/6492),
 * bukan hanya EOA.
 */
export async function verifyWalletAuth(p: {
  auth: unknown;
  action: WalletAction;
  jobId: string;
  detail: string;
}): Promise<string> {
  const a = p.auth as { address?: unknown; issuedAt?: unknown; signature?: unknown } | null;
  if (
    !a ||
    typeof a.address !== "string" ||
    !isAddress(a.address) ||
    typeof a.issuedAt !== "string" ||
    typeof a.signature !== "string" ||
    !SIGNATURE_RE.test(a.signature)
  ) {
    throw new Error("Wallet signature is missing or malformed");
  }

  const issued = Date.parse(a.issuedAt);
  const age = Date.now() - issued;
  if (!Number.isFinite(issued) || age > WALLET_AUTH_MAX_AGE_MS || age < -60_000) {
    throw new Error("Wallet signature expired -- try again");
  }

  const message = buildAuthMessage({
    action: p.action,
    jobId: p.jobId,
    detail: p.detail,
    issuedAt: a.issuedAt,
  });

  let valid = false;
  try {
    valid = await publicClient.verifyMessage({
      address: a.address,
      message,
      signature: a.signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) throw new Error("Wallet signature is invalid");

  return a.address.toLowerCase();
}
