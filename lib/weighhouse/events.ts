import { parseAbiItem, type AbiEvent } from "viem";

/**
 * Event ABI yang diindeks Weighhouse. Nama & argumen DIAMBIL DARI KONTRAK
 * (contracts/src/WageholdStrongbox.sol dan WageholdSplitter.sol), bukan ditebak.
 * Catatan: brief menyebut "job-created / released" -- di kontrak sebenarnya:
 *   job-created = JobFunded, released = SealSet, dispute dibuka = SealBroken.
 */
export const STRONGBOX_EVENTS = [
  parseAbiItem("event JobFunded(bytes32 indexed jobId, address indexed client, uint256 amount)"),
  parseAbiItem("event SealSet(bytes32 indexed jobId, address indexed payee, uint256 amount)"),
  parseAbiItem("event JobRefunded(bytes32 indexed jobId, address indexed client, uint256 amount)"),
  parseAbiItem("event SealBroken(bytes32 indexed jobId, address indexed client)"),
  parseAbiItem(
    "event DisputeResolved(bytes32 indexed jobId, address indexed payee, uint256 payeeAmount, uint256 refundAmount)",
  ),
] as const satisfies readonly AbiEvent[];

export const SPLITTER_EVENTS = [
  parseAbiItem("event JobRegistered(bytes32 indexed jobId, address indexed patronPool, uint256 amount)"),
  parseAbiItem(
    "event JobSplit(bytes32 indexed jobId, address indexed patronPool, uint256 patronAmount, uint256 lampOilAmount, uint256 titheAmount, uint256 burnAmount)",
  ),
  parseAbiItem("event Burned(address indexed caller, uint256 amount)"),
] as const satisfies readonly AbiEvent[];

/**
 * Splitter v2 (contracts/src/WageholdSplitterV2.sol). Event yang SAMA NAMA dengan v1 tapi signature
 * (jadi topic0) berbeda: argumen kedua `agentId bytes32`, bukan `patronPool address`. Karena itu
 * ABI v1 di atas TIDAK bisa membaca log v2 -- keduanya harus didaftarkan terpisah. Nama event
 * yang tersimpan di chain_events tetap sama (JobRegistered / JobSplit / Burned), jadi
 * weighhouse_flow() ikut menghitung v2 tanpa perubahan.
 */
export const SPLITTER_V2_EVENTS = [
  parseAbiItem("event JobRegistered(bytes32 indexed jobId, bytes32 indexed agentId, uint256 amount)"),
  parseAbiItem(
    "event JobSplit(bytes32 indexed jobId, bytes32 indexed agentId, uint256 patronAmount, uint256 lampOilAmount, uint256 titheAmount, uint256 burnAmount)",
  ),
  parseAbiItem("event Burned(address indexed caller, uint256 amount)"),
] as const satisfies readonly AbiEvent[];

/**
 * WageholdPatronage (contracts/src/WageholdPatronage.sol). Disimpan di chain_events dengan
 * `contract` = alamat Patronage. Hati-hati: `Withdrawn` juga nama event di Strongbox/Splitter
 * (signature lain) -- selalu saring dengan kolom `contract`, jangan hanya `event`.
 * patronage_apply() (0018) membaca Staked / UnstakeRequested / Withdrawn / Claimed /
 * RewardNotified / RewardRedirected / BuildingRegistered; RedirectFlushed hanya dicatat.
 */
export const PATRONAGE_EVENTS = [
  parseAbiItem("event Staked(bytes32 indexed agentId, address indexed user, uint256 amount)"),
  parseAbiItem("event UnstakeRequested(bytes32 indexed agentId, address indexed user, uint256 amount, uint256 unlockAt)"),
  parseAbiItem("event Withdrawn(bytes32 indexed agentId, address indexed user, uint256 amount)"),
  parseAbiItem("event Claimed(bytes32 indexed agentId, address indexed user, uint256 amount)"),
  parseAbiItem("event RewardNotified(bytes32 indexed agentId, bytes32 indexed jobId, uint256 amount, uint256 accRewardPerShare)"),
  parseAbiItem("event RewardRedirected(bytes32 indexed agentId, bytes32 indexed jobId, uint256 amount, address to)"),
  parseAbiItem("event RedirectFlushed(address indexed to, uint256 amount)"),
  parseAbiItem("event BuildingRegistered(bytes32 indexed agentId, bool on)"),
] as const satisfies readonly AbiEvent[];

/** Event Patronage yang tampil di ledger (Dev Brief §8.3, sesi 4C): stake baru, reward yang dibagi ke patron,
 *  dan reward yang dialihkan ke treasury karena tidak ada staker. Ketiga nama ini hanya dipancarkan kontrak
 *  Patronage, jadi menyaring berdasarkan nama aman (beda dengan `Withdrawn`). Digabung ke LEDGER_EVENT_NAMES di bawah. */
export const PATRONAGE_LEDGER_EVENT_NAMES: string[] = ["Staked", "RewardNotified", "RewardRedirected"];

/**
 * Event pasar Pons V2. Signature + topic0 diverifikasi terhadap dokumentasi Bitquery
 * (docs.bitquery.io/docs/blockchain/robinhood/pons-api) dengan keccak-256 -- semuanya cocok:
 *   CurveBuy  ec36bf57..., CurveSell 8113d738..., TokenLaunched 8d4aad49..., PoolGraduated 0a44ef75...
 * Bonding curve = satu kontrak per token; alamatnya ada di TokenLaunched.curve.
 */
export const CURVE_EVENTS = [
  parseAbiItem("event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)"),
  parseAbiItem("event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)"),
] as const satisfies readonly AbiEvent[];

export const TOKEN_LAUNCHED_EVENT = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);
export const POOL_GRADUATED_EVENT = parseAbiItem(
  "event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)",
);
/** Uniswap v4 PoolManager.Initialize -- dipakai skrip discover untuk membuktikan pool ID. */
export const V4_INITIALIZE_EVENT = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);

/** Uniswap v4 PoolManager.Swap -- selalu diindeks; pool ID diturunkan dari token + hook Pons (lib/weighhouse/pons.ts). */
export const POOL_SWAP_EVENT = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

export const ERC20_ABI = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Tipe event yang tampil di ledger (§4G). */
export type LedgerKind =
  | "Locked" | "Sealed" | "Refunded" | "Disputed" | "Resolved" | "Registered" | "Split" | "Burned" | "Swap" | "Trade" | "Graduated"
  | "Staked" | "Patron reward" | "Redirected";

export const EVENT_KIND: Record<string, LedgerKind> = {
  JobFunded: "Locked",
  SealSet: "Sealed",
  JobRefunded: "Refunded",
  SealBroken: "Disputed",
  DisputeResolved: "Resolved",
  JobRegistered: "Registered",
  JobSplit: "Split",
  Burned: "Burned",
  Swap: "Swap",
  CurveBuy: "Trade",
  CurveSell: "Trade",
  PoolGraduated: "Graduated",
  // Patronage (4C). Istilah netral sesuai §10: reward adalah bagian dari upah yang disegel, bukan imbal hasil.
  Staked: "Staked",
  RewardNotified: "Patron reward",
  RewardRedirected: "Redirected",
};

/** Event Strongbox + Splitter + tiga event Patronage yang tampil di ledger (§4G, §8.3); trade pasar dihitung,
 *  tidak ditampilkan. Nama sama antara v1 dan v2 (JobSplit dll.), jadi satu daftar nama cukup. */
export const LEDGER_EVENT_NAMES: string[] = [
  ...new Set([...STRONGBOX_EVENTS, ...SPLITTER_EVENTS].map((e) => e.name).concat(PATRONAGE_LEDGER_EVENT_NAMES)),
];
