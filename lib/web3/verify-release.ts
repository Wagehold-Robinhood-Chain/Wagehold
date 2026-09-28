import type { Address } from "viem";
import { publicClient } from "@/lib/web3/public-client";
import {
  computeJobId,
  isOnChainEscrowConfigured,
  strongboxAbi,
  strongboxAddress,
  JobStatus,
} from "@/lib/web3/strongbox";

/**
 * Fase 2 item 7 -- server-side half of "Set the seal". `POST
 * /api/jobs/:id/approve` calls this for any job that has an on-chain
 * escrow before it marks the job `paid` in Postgres: reads the job straight
 * off `WageholdStrongbox` and confirms the client's `approve()` really
 * landed (status `Released`). The database never gets to say "paid" on the
 * strength of a client's claim alone (Charter I -- the chain is the source
 * of truth for where the coin is).
 *
 * Returns the payee the wage was credited to (the Splitter when one is
 * configured, otherwise the Wright's wallet) so the caller can decide
 * whether `pullAndSplit` applies.
 */
export async function verifyReleased(jobUuid: string): Promise<{ payee: Address }> {
  if (!isOnChainEscrowConfigured || !strongboxAddress) {
    throw new Error("on-chain escrow is not configured on the server");
  }

  const job = await publicClient.readContract({
    address: strongboxAddress,
    abi: strongboxAbi,
    functionName: "getJob",
    args: [computeJobId(jobUuid)],
  });

  if (job.status !== JobStatus.Released) {
    throw new Error(`job is not Released on-chain (status=${job.status})`);
  }

  return { payee: job.payee };
}
