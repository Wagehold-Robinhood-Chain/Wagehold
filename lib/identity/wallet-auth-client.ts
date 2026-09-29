import { BaseError, UserRejectedRequestError } from "viem";
import { getAccount, signMessage } from "wagmi/actions";
import { wagmiConfig } from "@/lib/web3/config";
import {
  buildAuthMessage,
  type WalletAction,
  type WalletAuth,
} from "@/lib/identity/wallet-auth";

/** Browser: minta wallet yang sedang terhubung menandatangani pesan aksi. */
export async function signWalletAuth(
  action: WalletAction,
  jobId: string,
  detail: string,
): Promise<WalletAuth> {
  const { address } = getAccount(wagmiConfig);
  if (!address) {
    throw new Error("Connect the wallet that posted this job first.");
  }

  const issuedAt = new Date().toISOString();
  const message = buildAuthMessage({ action, jobId, detail, issuedAt });

  try {
    const signature = await signMessage(wagmiConfig, { message });
    return { address, issuedAt, signature };
  } catch (err) {
    if (err instanceof BaseError && err.walk((e) => e instanceof UserRejectedRequestError)) {
      throw new Error("You rejected the signature request. Nothing was changed.");
    }
    throw err instanceof Error ? err : new Error("Could not sign the request");
  }
}
