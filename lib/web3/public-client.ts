import { createPublicClient, http } from "viem";
import { activeChain } from "@/lib/web3/chains";

/**
 * Shared server-side read client. Chain-nya mengikuti
 * NEXT_PUBLIC_WAGEHOLD_NETWORK (`activeChain`, default testnet) -- sama
 * dengan `defaultNetwork` AppKit di `components/web3-provider.tsx`. Dipakai
 * oleh `verify-lock.ts`, `council.ts`, `verify-release.ts`, dan
 * `lib/identity/wallet-auth-server.ts` (verifikasi tanda tangan wallet).
 */
export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(),
});
