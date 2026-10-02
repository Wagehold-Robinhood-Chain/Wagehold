import { createWalletClient, http, isAddress, isAddressEqual, zeroAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "@/lib/web3/chains";
import { publicClient } from "@/lib/web3/public-client";
import { splitterAbi } from "@/lib/web3/splitter";
import {
  computeJobId,
  isOnChainEscrowConfigured,
  strongboxAbi,
  strongboxAddress,
  JobStatus,
} from "@/lib/web3/strongbox";

/**
 * Fase 2 item 7 -- the **council** side of "Set the seal".
 *
 * `WageholdStrongbox.approve` can only be called by the job's own client
 * (Charter I) -- that half runs in the browser wallet
 * (`lib/web3/set-the-seal.ts`). But `approve` reverts `PayeeNotSet` until
 * someone with the *council* role has wired a payee for the job
 * (`setPayee`, Charter II: an operator key, never an agent/LLM). That is
 * what this file does, from the server, using `COUNCIL_PRIVATE_KEY`.
 *
 * The payee is derived **server-side from the database** (the Wright
 * assigned to the job), never from anything the client sends -- a client
 * cannot choose where its own wage goes.
 *
 *   - `WAGEHOLD_SPLITTER_ADDRESS` set  -> payee = the Splitter, and the job is
 *     registered there (`registerJob`) with the Wright's wallet (or
 *     `WAGEHOLD_PATRON_POOL_ADDRESS`) as the Patron pool. After the client's
 *     seal, `pullAndSplit` divides the wage 60/20/10/10 on-chain.
 *   - Splitter not set                 -> payee = the Wright's own wallet
 *     (`agents.wallet`), no split (only sensible for an early testnet run).
 *
 * `COUNCIL_PRIVATE_KEY` must be the same address as `WageholdStrongbox
 * .council()` (and `WageholdSplitter.council()` if a Splitter is used) --
 * checked before any transaction is sent. Server-only: never prefix it with
 * `NEXT_PUBLIC_`.
 */

function toAddress(value: string | undefined): Address | undefined {
  if (!value) return undefined;
  return isAddress(value) ? value : undefined;
}

const splitterAddress = toAddress(process.env.WAGEHOLD_SPLITTER_ADDRESS);
const patronPoolFallback = toAddress(process.env.WAGEHOLD_PATRON_POOL_ADDRESS);

/** True once a council key is set. Does not validate the key itself -- a
 *  malformed key surfaces as an error from `getCouncil()` on first use. */
export const isCouncilConfigured = !!process.env.COUNCIL_PRIVATE_KEY;

function getCouncil() {
  const key = process.env.COUNCIL_PRIVATE_KEY;
  if (!key) throw new Error("COUNCIL_PRIVATE_KEY is not set on the server");
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("COUNCIL_PRIVATE_KEY is not a valid 32-byte hex private key");
  }
  const account = privateKeyToAccount(normalized as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: activeChain,
    transport: http(),
  });
  return { account, walletClient };
}

function requireStrongbox(): Address {
  if (!isOnChainEscrowConfigured || !strongboxAddress) {
    throw new Error("on-chain escrow is not configured on the server");
  }
  return strongboxAddress;
}

export type PrepareState = "ready" | "already_released";

/**
 * Makes sure the job's on-chain payee is wired (and, with a Splitter, that
 * the job is registered there) so the client's `approve()` will not revert.
 * Idempotent: safe to call again after a partial failure or a retry.
 *
 * Returns `already_released` when the job is already `Released` on-chain
 * (e.g. the client's seal tx succeeded but recording it failed) -- the
 * caller should skip the wallet transaction and just record the seal.
 */
export async function preparePayeeOnChain(
  jobUuid: string,
  wrightWallet: string | null | undefined
): Promise<{ state: PrepareState }> {
  const strongbox = requireStrongbox();
  const jobId = computeJobId(jobUuid);

  const job = await publicClient.readContract({
    address: strongbox,
    abi: strongboxAbi,
    functionName: "getJob",
    args: [jobId],
  });

  if (job.status === JobStatus.Released) return { state: "already_released" };
  if (job.status !== JobStatus.Open) {
    throw new Error(`job cannot be sealed: on-chain status is ${job.status}, not Open`);
  }

  // Decide the payee plan from server-side data only.
  const wallet = toAddress(wrightWallet ?? undefined);
  let payee: Address;
  let patronPool: Address | undefined;
  if (splitterAddress) {
    payee = splitterAddress;
    patronPool = wallet ?? patronPoolFallback;
    if (!patronPool) {
      throw new Error(
        "no Patron pool address: the Wright has no wallet and WAGEHOLD_PATRON_POOL_ADDRESS is not set"
      );
    }
  } else {
    if (!wallet) {
      throw new Error(
        "this Wright has no wallet address and no Splitter is configured (WAGEHOLD_SPLITTER_ADDRESS)"
      );
    }
    payee = wallet;
  }

  const { account, walletClient } = getCouncil();

  const onChainCouncil = await publicClient.readContract({
    address: strongbox,
    abi: strongboxAbi,
    functionName: "council",
  });
  if (!isAddressEqual(onChainCouncil, account.address)) {
    throw new Error("COUNCIL_PRIVATE_KEY is not the council of this Strongbox");
  }

  if (job.payee === zeroAddress || !isAddressEqual(job.payee, payee)) {
    const { request } = await publicClient.simulateContract({
      account,
      address: strongbox,
      abi: strongboxAbi,
      functionName: "setPayee",
      args: [jobId, payee],
    });
    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("setPayee transaction reverted");
  }

  if (splitterAddress && patronPool) {
    const split = await publicClient.readContract({
      address: splitterAddress,
      abi: splitterAbi,
      functionName: "getSplit",
      args: [jobId],
    });
    // `registerJob` snapshots the wage and the Patron pool once; an amount
    // of 0 means this job has not been registered yet.
    if (split.amount === BigInt(0)) {
      const { request } = await publicClient.simulateContract({
        account,
        address: splitterAddress,
        abi: splitterAbi,
        functionName: "registerJob",
        args: [jobId, patronPool],
      });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("registerJob transaction reverted");
    }
  }

  return { state: "ready" };
}

export type SplitResult =
  | { status: "split"; txHash: `0x${string}` }
  | { status: "skipped"; reason: string };

/**
 * After the client's seal: calls `WageholdSplitter.pullAndSplit(jobId)`,
 * which pulls the released wage out of the Strongbox and credits Patrons /
 * Lamp Oil / Tithe 60/20/10 and burns the 10% Furnace share in the same transaction (each destination then withdraws for itself).
 * `pullAndSplit` is permissionless -- the council key is only used here as a
 * funded account to send it, so a failure is never fatal: anyone can call it
 * later, and the caller records a "split pending" event instead.
 */
export async function splitAfterRelease(jobUuid: string): Promise<SplitResult> {
  if (!splitterAddress) return { status: "skipped", reason: "no Splitter configured" };

  const jobId = computeJobId(jobUuid);
  const split = await publicClient.readContract({
    address: splitterAddress,
    abi: splitterAbi,
    functionName: "getSplit",
    args: [jobId],
  });
  if (split.amount === BigInt(0)) {
    return { status: "skipped", reason: "job was never registered with the Splitter" };
  }
  if (split.split) return { status: "skipped", reason: "already split" };

  const { account, walletClient } = getCouncil();
  const { request } = await publicClient.simulateContract({
    account,
    address: splitterAddress,
    abi: splitterAbi,
    functionName: "pullAndSplit",
    args: [jobId],
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("pullAndSplit transaction reverted");

  return { status: "split", txHash: hash };
}
