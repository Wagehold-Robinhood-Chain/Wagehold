import { cookieStorage, createStorage } from "@wagmi/core";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { activeChain } from "@/lib/web3/chains";

/**
 * Project ID from https://cloud.reown.com (free) -- identifies this app to the WalletConnect
 * relay network, not a secret (it's meant to be public, hence `NEXT_PUBLIC_`). See
 * .env.local.example for where to put it.
 */
export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/** False until NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set (see .env.local.example) --
 *  checked by web3-provider.tsx (skips createAppKit) and wallet-connect.tsx (shows a
 *  disabled button instead of crashing) so a missing key degrades gracefully instead of
 *  taking down the whole app, same as how a missing Supabase env is handled
 *  (components/status-check.tsx) rather than a hard crash. */
export const isWeb3Configured = !!projectId;

export const networks = [activeChain] as const;

// Called from both server (layout.tsx, for SSR cookie hydration) and client
// (web3-provider.tsx) -- this file must stay free of "use client" and of any browser-only API.
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  projectId: projectId ?? "",
  networks: [...networks],
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
