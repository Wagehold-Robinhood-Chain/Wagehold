import { cookies } from "next/headers";
import { isWalletMode } from "@/lib/identity/mode";
import {
  SIM_COOKIE,
  isSimClientId,
  isValidSimSecret,
  simPublicId,
} from "@/lib/identity/sim-id";
import { verifyWalletAuth } from "@/lib/identity/wallet-auth-server";
import type { WalletAction } from "@/lib/identity/wallet-auth";

/** client_id milik browser ini (mode simulasi), dari cookie httpOnly `wh_sim`. */
export async function getSimClientId(): Promise<string | null> {
  const secret = (await cookies()).get(SIM_COOKIE)?.value;
  if (!isValidSimSecret(secret)) return null;
  return simPublicId(secret);
}

/** Identitas awal untuk Server Component. Di mode wallet server tidak tahu siapa
 *  yang membuka halaman (wallet hanya ada di browser), jadi null -- browser yang
 *  menentukan lewat lib/identity/use-identity.ts. */
export async function getInitialUserId(): Promise<string | null> {
  return isWalletMode ? null : getSimClientId();
}

export type OwnerCheck = { ok: true } | { ok: false; status: number; error: string };

/**
 * Gerbang kepemilikan job (Article I) untuk Set the seal / Send back, menggantikan
 * `supabase.auth.getUser()`:
 *
 * - job simulasi (`client_id` = `sim:...`): cookie `wh_sim` browser pemanggil harus
 *   cocok dengan pembuat job;
 * - job wallet (`client_id` = alamat): body harus membawa tanda tangan wallet
 *   (lib/identity/wallet-auth.ts) dari alamat pemilik job itu.
 *
 * Route tetap memverifikasi sendiri di sini -- bukan mengandalkan proxy.ts.
 */
export async function authorizeJobOwner(p: {
  clientId: string;
  action: WalletAction;
  jobId: string;
  detail: string;
  auth: unknown;
  /** frasa untuk pesan error, mis. "set the seal" */
  verb: string;
}): Promise<OwnerCheck> {
  if (isSimClientId(p.clientId)) {
    const mine = await getSimClientId();
    if (!mine) {
      return {
        ok: false,
        status: 401,
        error: "This browser has no identity yet -- reload the page and try again",
      };
    }
    if (mine !== p.clientId) {
      return {
        ok: false,
        status: 403,
        error: `Only the browser that posted this job can ${p.verb}`,
      };
    }
    return { ok: true };
  }

  let signer: string;
  try {
    signer = await verifyWalletAuth({
      auth: p.auth,
      action: p.action,
      jobId: p.jobId,
      detail: p.detail,
    });
  } catch (err) {
    return {
      ok: false,
      status: 401,
      error: err instanceof Error ? err.message : "Wallet signature check failed",
    };
  }
  if (signer !== p.clientId.toLowerCase()) {
    return {
      ok: false,
      status: 403,
      error: `Only the wallet that posted this job can ${p.verb}`,
    };
  }
  return { ok: true };
}
