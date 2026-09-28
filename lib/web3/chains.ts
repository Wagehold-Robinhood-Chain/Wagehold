import { defineChain } from "@reown/appkit/networks";

/**
 * Robinhood Chain -- Arbitrum Orbit, fully EVM-compatible (see contracts/README.md §Chain
 * target for the full writeup). Not in `@reown/appkit/networks`' built-in list yet, so it's
 * defined here by hand per https://docs.reown.com/appkit/next/core/custom-networks.
 *
 * RPC defaults to Alchemy (the provider recommended by docs.robinhood.com/chain -- the public
 * endpoint `rpc.testnet.chain.robinhood.com` is rate-limited and not meant for real traffic).
 * `NEXT_PUBLIC_*` env vars are exposed to the browser by design here: this is the wallet's own
 * RPC endpoint for reading chain state, the same way any dApp's frontend needs a public RPC
 * URL. Domain-restrict the Alchemy key in the Alchemy dashboard before shipping this beyond
 * localhost -- see .env.local.example.
 */
export const robinhoodTestnet = defineChain({
  id: 46630,
  caipNetworkId: "eip155:46630",
  chainNamespace: "eip155",
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL ??
          "https://rpc.testnet.chain.robinhood.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Testnet Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

export const robinhoodMainnet = defineChain({
  id: 4663,
  caipNetworkId: "eip155:4663",
  chainNamespace: "eip155",
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ROBINHOOD_MAINNET_RPC_URL ??
          "https://rpc.mainnet.chain.robinhood.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});

/** Dipakai di beberapa tempat (wallet-connect.tsx, lib/web3/lock-wage.ts,
 *  components/post-job-client.tsx) untuk mengecek jaringan wallet yang
 *  sedang aktif -- satu sumber kebenaran, bukan didefinisikan ulang di
 *  tiap file. */
export const SUPPORTED_CHAIN_IDS = new Set<number>([robinhoodTestnet.id, robinhoodMainnet.id]);
