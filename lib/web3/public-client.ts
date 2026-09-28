import { createPublicClient, http } from "viem";
import { robinhoodTestnet } from "@/lib/web3/chains";

/**
 * Shared server-side read client. Reads Robinhood Chain **testnet** only --
 * the app's `defaultNetwork` is `robinhoodTestnet` (see
 * `components/web3-provider.tsx`) and mainnet isn't live for Wagehold yet.
 * If mainnet is ever wired up, this needs to pick the chain per job instead
 * of assuming testnet. Used by `verify-lock.ts` (item 6) and `council.ts` /
 * `verify-release.ts` (item 7).
 */
export const publicClient = createPublicClient({
  chain: robinhoodTestnet,
  transport: http(),
});
