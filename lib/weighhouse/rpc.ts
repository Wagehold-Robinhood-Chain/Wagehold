import { createPublicClient, http } from "viem";
import { activeChain } from "@/lib/web3/chains";

/**
 * Client RPC khusus Weighhouse (indexer, snapshot supply, snapshot harga).
 *
 * Indexer memanggil eth_getLogs dengan rentang besar (CHUNK blok), yang ditolak RPC paket gratis
 * (mis. Alchemy Free: maks. 10 blok). Karena itu RPC-nya bisa dipisah dari RPC dompet/browser:
 *   WEIGHHOUSE_RPC_URL=<RPC tanpa batas getLogs>   (server-only, tanpa awalan NEXT_PUBLIC_)
 * Kosong = pakai RPC bawaan activeChain (NEXT_PUBLIC_ROBINHOOD_MAINNET_RPC_URL atau endpoint publik).
 * Alur dompet (verify-lock, council, dll.) tetap memakai `publicClient` di lib/web3/public-client.ts.
 */
export const weighhouseClient = createPublicClient({
  chain: activeChain,
  transport: http(process.env.WEIGHHOUSE_RPC_URL || undefined),
});
