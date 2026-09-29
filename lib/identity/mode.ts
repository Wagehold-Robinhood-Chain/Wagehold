import { isOnChainEscrowConfigured } from "@/lib/web3/strongbox";

/**
 * Dua mode identitas, tanpa login:
 *
 * - MODE WALLET: aktif kalau escrow on-chain terkonfigurasi
 *   (NEXT_PUBLIC_STRONGBOX_ADDRESS + NEXT_PUBLIC_WAGE_TOKEN_ADDRESS; jaringan dipilih
 *   NEXT_PUBLIC_WAGEHOLD_NETWORK). Pemilik job = alamat wallet yang mengunci wage.
 * - MODE SIMULASI: default sekarang. Pemilik job = browser yang membuatnya
 *   (cookie httpOnly `wh_sim`, lihat lib/identity/sim-id.ts). Tanpa wallet.
 *
 * Dihitung dari env NEXT_PUBLIC_*, jadi nilainya sama di server dan di browser.
 */
export const isWalletMode = isOnChainEscrowConfigured;
export const isSimulationMode = !isWalletMode;
