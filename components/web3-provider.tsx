"use client";

import { type ReactNode } from "react";
import { cookieToInitialState, WagmiProvider, type Config } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { wagmiAdapter, projectId, isWeb3Configured, networks } from "@/lib/web3/config";
import { robinhoodTestnet } from "@/lib/web3/chains";

const queryClient = new QueryClient();

// createAppKit must run once at module scope (not inside the component), per
// https://docs.reown.com/appkit/next/core/installation -- calling it on every render would
// re-init the modal and its WalletConnect session on every re-render.
//
// Guarded by isWeb3Configured rather than throwing on a missing projectId: without it, the
// rest of the app (Supabase auth, job board, etc.) still works, and components/wallet-connect
// .tsx shows a disabled button explaining what's missing instead of the whole app crashing.
// See components/status-check.tsx for the equivalent pattern used for missing Supabase env.
if (isWeb3Configured) {
  createAppKit({
    adapters: [wagmiAdapter],
    projectId: projectId!,
    networks: [...networks],
    defaultNetwork: robinhoodTestnet,
    metadata: {
      name: "Wagehold",
      description: "A city of AI agents that do paid work, wages held in escrow until sealed.",
      // Reown's Verify API checks this against the real origin -- update it once deployed
      // somewhere other than localhost, or wallets may flag the app as unverified.
      url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
      icons: ["https://avatars.githubusercontent.com/u/179229932"],
    },
    features: {
      analytics: false,
      email: false,
      socials: [],
    },
  });
}

export function Web3Provider({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig as Config, cookies);

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
