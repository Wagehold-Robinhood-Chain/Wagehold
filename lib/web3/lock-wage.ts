import { erc20Abi, formatUnits, parseUnits } from 'viem';
import {
  getAccount,
  getChainId,
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions';
import { wagmiConfig } from '@/lib/web3/config';
import { SUPPORTED_CHAIN_IDS, activeChain } from '@/lib/web3/chains';
import {
  computeJobId,
  isOnChainEscrowConfigured,
  strongboxAbi,
  strongboxAddress,
  wageTokenAddress,
} from '@/lib/web3/strongbox';

export class UnsupportedNetworkError extends Error {
  constructor() {
    super(
      'Switch your wallet to Robinhood Chain before locking the wage on-chain.',
    );
    this.name = 'UnsupportedNetworkError';
  }
}

export class InsufficientWageError extends Error {
  constructor(have: string, need: string) {
    super(
      `Your wallet has ${have} $WAGEHOLD but this job needs ${need}. ` +
        `Get more $WAGEHOLD on Robinhood Chain first (your ETH is only used for gas).`,
    );
    this.name = 'InsufficientWageError';
  }
}

export class WalletRejectedError extends Error {
  constructor() {
    super(
      "You rejected the transaction in your wallet. Nothing was sent -- post the job again when you're ready.",
    );
    this.name = 'WalletRejectedError';
  }
}

function isUserRejection(err: unknown): boolean {
  const e = err as {
    name?: string;
    code?: number;
    shortMessage?: string;
    message?: string;
  };
  return (
    e?.name === 'UserRejectedRequestError' ||
    e?.code === 4001 ||
    /user rejected|rejected the request|user denied/i.test(
      `${e?.shortMessage ?? ''} ${e?.message ?? ''}`,
    )
  );
}

export interface LockWageResult {
  txHash: `0x${string}`;
  /** The bytes32 the wage was locked under -- `keccak256(bytes(jobUuid))`.
   *  Not sent back to the server separately; the server recomputes it from
   *  `jobUuid` itself rather than trusting a client-supplied value. */
  onChainJobId: `0x${string}`;
}

/**
 * Fase 2 item 6 -- locks `budgetUsdc` of `wageToken` into `WageholdStrongbox`
 * under `jobUuid` (via `createJob`), approving the ERC20 allowance first if
 * the Strongbox doesn't already have enough. `jobUuid` should be a UUID the
 * caller generated client-side (`crypto.randomUUID()`) for a job that does
 * not exist in Postgres yet -- `POST /api/jobs` is what actually creates the
 * row, using this same id, once this function returns.
 *
 * Throws on any failure (missing config, wrong network, no wallet, rejected
 * signature, reverted tx). Deliberately does not catch-and-fallback to the
 * simulated flow -- a partially-succeeded on-chain call (e.g. the approval
 * went through but `createJob` didn't) must surface as an error, not be
 * silently swallowed into "well, we'll just pretend it's simulated".
 */
export async function lockWageOnChain(
  jobUuid: string,
  budgetUsdc: number,
): Promise<LockWageResult> {
  try {
    return await lockWageOnChainInner(jobUuid, budgetUsdc);
  } catch (err) {
    if (isUserRejection(err)) throw new WalletRejectedError();
    throw err;
  }
}

async function lockWageOnChainInner(
  jobUuid: string,
  budgetUsdc: number,
): Promise<LockWageResult> {
  if (!isOnChainEscrowConfigured || !strongboxAddress || !wageTokenAddress) {
    throw new Error(
      "On-chain escrow isn't configured yet (NEXT_PUBLIC_STRONGBOX_ADDRESS / NEXT_PUBLIC_WAGE_TOKEN_ADDRESS).",
    );
  }

  const chainId = getChainId(wagmiConfig);
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
    throw new UnsupportedNetworkError();
  }

  const { address } = getAccount(wagmiConfig);
  if (!address) {
    throw new Error('Connect your wallet first to lock the wage on-chain.');
  }

  const decimals = await readContract(wagmiConfig, {
    address: wageTokenAddress,
    abi: erc20Abi,
    chainId: activeChain.id,
    functionName: 'decimals',
  });

  const amount = parseUnits(budgetUsdc.toFixed(decimals), decimals);
  const onChainJobId = computeJobId(jobUuid);

  // Cek saldo token SEBELUM meminta tanda tangan apa pun. Wallet yang hanya punya ETH
  // (saldo token 0) bisa tetap dibaca; approve() tidak akan pernah diminta kalau
  // saldonya memang tidak cukup untuk createJob.
  const balance = await readContract(wagmiConfig, {
    address: wageTokenAddress,
    abi: erc20Abi,
    chainId: activeChain.id,
    functionName: 'balanceOf',
    args: [address],
  });
  if (balance < amount) {
    throw new InsufficientWageError(
      formatUnits(balance, decimals),
      formatUnits(amount, decimals),
    );
  }

  const allowance = await readContract(wagmiConfig, {
    address: wageTokenAddress,
    abi: erc20Abi,
    chainId: activeChain.id,
    functionName: 'allowance',
    args: [address, strongboxAddress],
  });

  if (allowance < amount) {
    const approveHash = await writeContract(wagmiConfig, {
      address: wageTokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [strongboxAddress, amount],
    });
    await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
  }

  const txHash = await writeContract(wagmiConfig, {
    address: strongboxAddress,
    abi: strongboxAbi,
    functionName: 'createJob',
    args: [onChainJobId, amount],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash: txHash });

  return { txHash, onChainJobId };
}
