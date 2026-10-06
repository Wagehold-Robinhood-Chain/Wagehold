import { activeChain } from "@/lib/web3/chains";

/**
 * Satu sumber kebenaran untuk semua alamat Wagehold + Pons/Uniswap v4 (Dev Brief Weighhouse §2).
 * JANGAN hard-code alamat di komponen -- impor dari sini.
 *
 * Semua disimpan lowercase supaya aman dibandingkan dan tidak kena validasi checksum viem.
 * Alamat Pons/Uniswap v4 berasal dari dokumen publik Bitquery: verifikasi di Blockscout sebelum
 * dipakai di production.
 */
const lc = (a: string) => a.toLowerCase() as `0x${string}`;
const optional = (v: string | undefined) => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? lc(v) : undefined);

export const ADDRESSES = {
  wageToken: lc("0x1946b849518b87d52985ae1aeeb163a59089f2c8"),
  strongbox: lc("0xa6e141F52E156488E08bdE34A81Af1241de2CBEf"),
  splitter: lc("0x94c173568f2Cf61617B83440DE8F56Baeed39D8c"),
  owner: lc("0xFb8010fA96d3E8ba91eac316027b36716D3FE991"),
  council: lc("0x606C6aE7421C4c13d9c595AEb703F8E3A8eEAD28"),
  lampOilTreasury: lc("0x9Ce97Ee98e3B48b938903e46f7f6E8466Fc040f1"),
  titheTreasury: lc("0x011b714B35ddf49e874C1A759078be692152d3e5"),
  furnace: lc("0x000000000000000000000000000000000000dEaD"),
  deployer: lc("0x60B31fb1cDf3f3BB8A12B666e82b4F363ecdE0fE"),
} as const;

export const PONS = {
  launchFactory: lc("0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e"),
  launchRouter: lc("0xe33e9e479df8802cb0866d5d05258bec4cf62948"),
  memeHook: lc("0xe5e702641ea86f4ae6cc3cdaed2b886f976be044"),
  launchLocker: lc("0x267444d099b10fb5ed7c3cc7b7c767adca574952"),
  poolManager: lc("0x8366a39cc670b4001a1121b8f6a443a643e40951"),
} as const;

/** Item "TODO" di brief §9 -- diisi lewat env sampai tim punya nilainya. Kosong = fitur
 *  terkait mati dengan anggun (bukan error). */
export const OPEN_ITEMS = {
  /** Blok deploy Strongbox/Splitter paling awal; indexer mulai dari sini. */
  deployBlock: process.env.WEIGHHOUSE_DEPLOY_BLOCK ? BigInt(process.env.WEIGHHOUSE_DEPLOY_BLOCK) : undefined,
  /** Kontrak bonding curve per-token (pra-graduation). */
  wageCurve: optional(process.env.WEIGHHOUSE_WAGE_CURVE),
  /** Quote asset launch Pons ($WAGE dikutip terhadap apa). Kosong = ETH native (address(0)), default Pons.
   *  `scripts/weighhouse-discover.ts` membaca nilai sebenarnya dari event TokenLaunched. */
  pairToken: optional(process.env.WEIGHHOUSE_PAIR_TOKEN),
  /** Blok awal untuk event PASAR (curve + pool). Kosong = sama dengan deployBlock. Isi dengan blok
   *  launch $WAGE kalau ingin volume trading dihitung sejak launch (backfill lebih lama). */
  marketStartBlock: process.env.WEIGHHOUSE_MARKET_START_BLOCK ? BigInt(process.env.WEIGHHOUSE_MARKET_START_BLOCK) : undefined,
  /** OPSIONAL override pool ID (bytes32). Normalnya DIHITUNG otomatis dari token + hook Pons. */
  v4PoolId: /^0x[0-9a-fA-F]{64}$/.test(process.env.WEIGHHOUSE_V4_POOL_ID ?? "")
    ? (process.env.WEIGHHOUSE_V4_POOL_ID!.toLowerCase() as `0x${string}`)
    : undefined,
  /** Kontrak StateView Uniswap v4 (untuk membaca slot0 / likuiditas pool). */
  v4StateView: optional(process.env.WEIGHHOUSE_V4_STATE_VIEW),
} as const;

/** Patronage build (Strongbox v2 + Splitter v2 + WageholdPatronage). Semua OPSIONAL: kosong = aliran
 *  indexer Patronage mati dengan anggun (Weighhouse lama tetap jalan). Isi SETELAH batch Timelock
 *  (acceptOwnership) selesai -- lihat contracts/PATRONAGE_ROLLOUT.md.
 *  `deployBlock` = blok PEMBUATAN kontrak paling awal di antara ketiganya (bukan blok cut-over):
 *  event sebelum blok ini tidak akan pernah diindeks. */
export const PATRONAGE = {
  patronage: optional(process.env.WEIGHHOUSE_PATRONAGE_ADDRESS),
  strongboxV2: optional(process.env.WEIGHHOUSE_STRONGBOX_V2_ADDRESS),
  splitterV2: optional(process.env.WEIGHHOUSE_SPLITTER_V2_ADDRESS),
  deployBlock: process.env.WEIGHHOUSE_PATRONAGE_DEPLOY_BLOCK ? BigInt(process.env.WEIGHHOUSE_PATRONAGE_DEPLOY_BLOCK) : undefined,
} as const;

export const WAGE_DECIMALS = 18;
export const WAGE_TOTAL_SUPPLY_CAP = 1_000_000_000; // untuk "% supply terbakar" (brief §4D)

// ---- Blockscout ---------------------------------------------------------------------------
// Brief: "Robinhood Chain mainnet (chain ID 4663)". Link explorer mengikuti activeChain supaya
// rehearsal testnet tidak menunjuk ke mainnet.
const explorer = (activeChain.blockExplorers?.default.url ?? "https://robinhoodchain.blockscout.com").replace(/\/$/, "");
export const explorerAddress = (a: string) => `${explorer}/address/${a}`;
export const explorerTx = (h: string) => `${explorer}/tx/${h}`;
export const explorerToken = (a: string) => `${explorer}/token/${a}`;
export const explorerBlock = (n: number | bigint | string) => `${explorer}/block/${n}`;

/** Link halaman Pons $WAGE. Sengaja lewat env (tidak ada URL yang bisa kami verifikasi); kosong = link disembunyikan. */
export const PONS_TOKEN_URL = process.env.NEXT_PUBLIC_PONS_TOKEN_URL || undefined;

/** Pre-flight (brief §2): token yang dipakai app harus sama dengan CA di brief. Dipakai oleh
 *  scripts/weighhouse-preflight.ts dan peringatan dev-console di halaman. */
export function appTokenMatchesBrief(): boolean {
  const env = process.env.NEXT_PUBLIC_WAGE_TOKEN_ADDRESS?.toLowerCase();
  return !env || env === ADDRESSES.wageToken;
}
