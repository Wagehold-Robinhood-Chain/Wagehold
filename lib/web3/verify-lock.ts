import { erc20Abi, formatUnits } from 'viem';
import { publicClient } from '@/lib/web3/public-client';
import {
  computeJobId,
  isOnChainEscrowConfigured,
  strongboxAbi,
  strongboxAddress,
  wageTokenAddress,
  JobStatus,
} from '@/lib/web3/strongbox';

/**
 * Fase 2 item 6 -- server-side half of the on-chain lock. `POST /api/jobs`
 * calls this whenever a client claims a wage is already locked (`id` +
 * `escrowTx` in the request body) instead of just trusting the claim: reads
 * the job straight off `WageholdStrongbox` at the jobId derived from
 * `jobUuid` and confirms it's actually `Open` with a nonzero amount.
 *
 * Returns the wage amount **as read from the chain**, in wage-token units (human
 * units) -- the caller should use this instead of whatever `budgetUsdc` the
 * client sent in the request body, so a client can't claim a bigger wage
 * than what it actually locked. Also returns `client`, the (lowercase) wallet that
 * locked it: that address becomes the job's owner (`jobs.client_id`).
 *
 * Throws (with a message safe to surface to the client) if escrow isn't
 * configured, the RPC call fails, or the job isn't in the expected state.
 */
export async function verifyOnChainLock(
  jobUuid: string,
): Promise<{ budgetUsdc: number; client: string }> {
  if (!isOnChainEscrowConfigured || !strongboxAddress || !wageTokenAddress) {
    throw new Error('on-chain escrow is not configured on the server');
  }

  const onChainJobId = computeJobId(jobUuid);

  const [job, decimals] = await Promise.all([
    publicClient.readContract({
      address: strongboxAddress,
      abi: strongboxAbi,
      functionName: 'getJob',
      args: [onChainJobId],
    }),
    publicClient.readContract({
      address: wageTokenAddress,
      abi: erc20Abi,
      functionName: 'decimals',
    }),
  ]);

  if (job.status !== JobStatus.Open) {
    throw new Error(
      `job is not Open on-chain (status=${job.status}) -- was it really locked?`,
    );
  }
  if (job.amount <= BigInt(0)) {
    throw new Error('job has a zero amount on-chain');
  }

  return {
    budgetUsdc: Number(formatUnits(job.amount, decimals)),
    // Pemilik job = alamat yang benar-benar mengunci wage (dibaca dari chain,
    // bukan dari body request) -- inilah pengganti user id Supabase.
    client: job.client.toLowerCase(),
  };
}
