import { erc20Abi, parseUnits } from "viem";
import {
  getAccount,
  getChainId,
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import { wagmiConfig } from "@/lib/web3/config";
import { SUPPORTED_CHAIN_IDS } from "@/lib/web3/chains";
import {
  computeJobId,
  isOnChainEscrowConfigured,
  strongboxAbi,
  strongboxAddress,
  wageTokenAddress,
} from "@/lib/web3/strongbox";

export class UnsupportedNetworkError extends Error {
  constructor() {
    super("Switch your wallet to Robinhood Chain before locking the wage on-chain.");
    this.name = "UnsupportedNetworkError";
  }
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
  budgetUsdc: number
): Promise<LockWageResult> {
  if (!isOnChainEscrowConfigured || !strongboxAddress || !wageTokenAddress) {
    throw new Error(
      "On-chain escrow isn't configured yet (NEXT_PUBLIC_STRONGBOX_ADDRESS / NEXT_PUBLIC_WAGE_TOKEN_ADDRESS)."
    );
  }

  const chainId = getChainId(wagmiConfig);
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
    throw new UnsupportedNetworkError();
  }

  const { address } = getAccount(wagmiConfig);
  if (!address) {
    throw new Error("Connect your wallet first to lock the wage on-chain.");
  }

  const decimals = await readContract(wagmiConfig, {
    address: wageTokenAddress,
    abi: erc20Abi,
    functionName: "decimals",
  });

  const amount = parseUnits(budgetUsdc.toFixed(decimals), decimals);
  const onChainJobId = computeJobId(jobUuid);

  const allowance = await readContract(wagmiConfig, {
    address: wageTokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address, strongboxAddress],
  });

  if (allowance < amount) {
    const approveHash = await writeContract(wagmiConfig, {
      address: wageTokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [strongboxAddress, amount],
    });
    await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
  }

  const txHash = await writeContract(wagmiConfig, {
    address: strongboxAddress,
    abi: strongboxAbi,
    functionName: "createJob",
    args: [onChainJobId, amount],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash: txHash });

  return { txHash, onChainJobId };
}
