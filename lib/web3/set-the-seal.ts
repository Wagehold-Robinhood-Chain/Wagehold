import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  isAddressEqual,
  zeroAddress,
} from 'viem';
import {
  getAccount,
  getChainId,
  readContract,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions';
import { wagmiConfig } from '@/lib/web3/config';
import { SUPPORTED_CHAIN_IDS } from '@/lib/web3/chains';
import {
  computeJobId,
  isOnChainEscrowConfigured,
  JobStatus,
  strongboxAbi,
  strongboxAddress,
} from '@/lib/web3/strongbox';

/** Pesan yang bisa dibaca manusia untuk custom error `WageholdStrongbox`
 *  yang bisa muncul dari `approve()`. */
const REVERT_MESSAGES: Record<string, string> = {
  NotClient:
    'Only the wallet that locked this wage can set the seal. Connect that wallet.',
  PayeeNotSet: 'No payee has been assigned on-chain for this job yet.',
  InvalidStatus:
    'This job is no longer open on-chain -- it may already be sealed.',
  JobNotFound: "This job's wage was not found on-chain.",
};

function describeChainError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) {
      return 'You rejected the transaction in your wallet. Nothing was sealed.';
    }
    const reverted = err.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    );
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && REVERT_MESSAGES[name]) return REVERT_MESSAGES[name];
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : 'The seal transaction failed';
}

/**
 * Sends `WageholdStrongbox.approve(jobId)` from the connected wallet -- the
 * on-chain "Set the seal". Only the job's own client can do this (Charter
 * I), so before asking the wallet to sign we check that the connected
 * account really is the one that locked the wage. Returns `txHash: null`
 * when the job is already `Released` on-chain (retry after a failed
 * record-keeping step) -- nothing to send in that case.
 */
export async function sealOnChain(
  jobUuid: string,
): Promise<{ txHash: `0x${string}` | null }> {
  if (!isOnChainEscrowConfigured || !strongboxAddress) {
    throw new Error(
      "On-chain escrow isn't configured (NEXT_PUBLIC_STRONGBOX_ADDRESS).",
    );
  }

  const chainId = getChainId(wagmiConfig);
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
    throw new Error(
      'Switch your wallet to Robinhood Chain before setting the seal.',
    );
  }

  const { address } = getAccount(wagmiConfig);
  if (!address) {
    throw new Error(
      'Connect your wallet first -- the seal is set from the wallet that locked the wage.',
    );
  }

  const jobId = computeJobId(jobUuid);

  try {
    const job = await readContract(wagmiConfig, {
      address: strongboxAddress,
      abi: strongboxAbi,
      functionName: 'getJob',
      args: [jobId],
    });

    if (job.status === JobStatus.Released) return { txHash: null };
    if (job.status !== JobStatus.Open) {
      throw new Error(
        'This job is no longer open on-chain -- it may already be sealed or disputed.',
      );
    }
    if (!isAddressEqual(job.client, address)) {
      throw new Error(
        `Connect the wallet that locked this wage (${job.client.slice(0, 6)}…${job.client.slice(-4)}).`,
      );
    }
    if (job.payee === zeroAddress) {
      throw new Error('No payee has been assigned on-chain for this job yet.');
    }

    // Simulate first so a revert surfaces as a readable message instead of
    // a generic wallet error.
    await simulateContract(wagmiConfig, {
      address: strongboxAddress,
      abi: strongboxAbi,
      functionName: 'approve',
      args: [jobId],
    });

    const txHash = await writeContract(wagmiConfig, {
      address: strongboxAddress,
      abi: strongboxAbi,
      functionName: 'approve',
      args: [jobId],
    });
    const receipt = await waitForTransactionReceipt(wagmiConfig, {
      hash: txHash,
    });
    if (receipt.status !== 'success') {
      throw new Error('The seal transaction reverted on-chain.');
    }

    return { txHash };
  } catch (err) {
    if (err instanceof BaseError) throw new Error(describeChainError(err));
    throw err;
  }
}

async function postJson(
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      (data as { error?: string }).error ?? 'Something went wrong',
    );
  return data as Record<string, unknown>;
}

/**
 * Fase 2 item 7 -- the whole "Set the seal" action, shared by Job Board and
 * Job Detail.
 *
 * - Job with an on-chain escrow (`escrowTx` set, escrow configured):
 *   1. `POST /seal/prepare` -- server wires the payee on-chain (council key);
 *   2. wallet sends `approve(jobId)` -- the actual release;
 *   3. `POST /approve` with the tx hash -- server re-reads the chain, only then
 *      marks the job `paid`.
 * - Any other job (simulated escrow): the old one-step `POST /approve`.
 *
 * `onStep` receives a short label for the button while each step runs.
 * Throws with a message safe to show to the user.
 */
export async function setTheSeal(
  job: { id: string; escrowTx?: string | null },
  onStep?: (label: string) => void,
  /** Rating 1-5 opsional client untuk Wright ini (Client rating, dihitung
   *  di lib/agent-stats.ts). Diteruskan apa adanya ke POST /approve. */
  rating?: number,
): Promise<void> {
  const onChain = !!job.escrowTx && isOnChainEscrowConfigured;
  let sealTx: string | undefined;

  if (onChain) {
    onStep?.('Preparing the payee…');
    const prep = await postJson(`/api/jobs/${job.id}/seal/prepare`);

    if (prep.state !== 'already_released') {
      onStep?.('Confirm in your wallet…');
      const { txHash } = await sealOnChain(job.id);
      if (txHash) sealTx = txHash;
    }

    onStep?.('Recording the seal…');
  }

  const body: { sealTx?: string; rating?: number } = {};
  if (sealTx) body.sealTx = sealTx;
  if (rating !== undefined) body.rating = rating;

  await postJson(
    `/api/jobs/${job.id}/approve`,
    Object.keys(body).length > 0 ? body : undefined,
  );
}
