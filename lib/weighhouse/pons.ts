import { encodeAbiParameters, encodePacked, keccak256, parseAbi, toHex, type Hex, type PublicClient } from "viem";
import { ADDRESSES, OPEN_ITEMS, PONS } from "@/lib/web3/addresses";
import { ERC20_ABI } from "./events";
import {
  LIQUIDITY_OFFSET, POOLS_SLOT, decodeLiquidity, decodeSlot0, fullRangeReserves, tickMatchesSqrt,
} from "./v4math";

/**
 * Pons V2 + Uniswap v4, tanpa tebakan.
 *
 * Fakta dari dokumentasi Bitquery (docs.bitquery.io/docs/blockchain/robinhood/pons-api):
 *  - Pool hasil graduation SELALU: fee = 0, tickSpacing = 200, hooks = PonsV2MemeHook.
 *  - Quote default = ETH native (address(0)); currency0/currency1 diurutkan menurut alamat.
 *  - Likuiditas graduation = satu posisi full-range yang dikunci di PonsV2LaunchLocker.
 * Jadi pool ID = keccak256(abi.encode(PoolKey)) bisa DIHITUNG dari token + quote -- tanpa env, tanpa API.
 * Skrip scripts/weighhouse-discover.ts membuktikannya terhadap event Initialize on-chain.
 */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const PONS_POOL_FEE = 0;
export const PONS_POOL_TICK_SPACING = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = PublicClient<any, any>;

export interface WagePoolKey {
  poolId: Hex;
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  quote: `0x${string}`;
  wageIsToken0: boolean;
  poolIdSource: "derived" | "env";
}

let cachedKey: WagePoolKey | undefined;

/** Pool ID + urutan currency. Tanpa argumen = konfigurasi aplikasi (di-cache; murah dipanggil per baris).
 *  Dengan `quoteOverride` = hitung untuk quote tertentu (dipakai skrip discover; mengabaikan override env pool ID). */
export function wagePoolKey(quoteOverride?: `0x${string}`): WagePoolKey {
  if (!quoteOverride && cachedKey) return cachedKey;

  const wage = ADDRESSES.wageToken;
  const quote = quoteOverride ?? OPEN_ITEMS.pairToken ?? ZERO_ADDRESS;
  const wageIsToken0 = BigInt(wage) < BigInt(quote);
  const [currency0, currency1] = wageIsToken0 ? [wage, quote] : [quote, wage];
  const derived = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [currency0, currency1, PONS_POOL_FEE, PONS_POOL_TICK_SPACING, PONS.memeHook],
    ),
  );
  const useEnv = !quoteOverride && !!OPEN_ITEMS.v4PoolId;
  const key: WagePoolKey = {
    poolId: useEnv ? OPEN_ITEMS.v4PoolId! : derived, currency0, currency1, quote, wageIsToken0,
    poolIdSource: useEnv ? "env" : "derived",
  };
  if (!quoteOverride) cachedKey = key;
  return key;
}

const EXTSLOAD_ABI = parseAbi(["function extsload(bytes32 slot) view returns (bytes32 value)"]);
const STATE_VIEW_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

export interface PoolState { sqrtPriceX96: bigint; tick: number; liquidity: bigint }

/**
 * Baca slot0 + likuiditas aktif. `null` = pool belum diinisialisasi (belum graduation).
 * Throw = pembacaan gagal atau layout storage tak dikenali (jangan dianggap "belum graduation").
 * Pakai StateView kalau WEIGHHOUSE_V4_STATE_VIEW diisi; kalau tidak, extsload langsung ke PoolManager.
 */
export async function readPoolState(client: AnyClient, poolId: Hex, blockNumber?: bigint): Promise<PoolState | null> {
  const at = blockNumber === undefined ? {} : { blockNumber };

  let sqrtPriceX96: bigint, tick: number, liquidity: bigint;
  if (OPEN_ITEMS.v4StateView) {
    const [slot0, liq] = await Promise.all([
      client.readContract({ address: OPEN_ITEMS.v4StateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [poolId], ...at }),
      client.readContract({ address: OPEN_ITEMS.v4StateView, abi: STATE_VIEW_ABI, functionName: "getLiquidity", args: [poolId], ...at }),
    ]);
    sqrtPriceX96 = slot0[0]; tick = Number(slot0[1]); liquidity = liq;
  } else {
    const base = keccak256(encodePacked(["bytes32", "bytes32"], [poolId, toHex(POOLS_SLOT, { size: 32 })]));
    const liqSlot = toHex(BigInt(base) + LIQUIDITY_OFFSET, { size: 32 });
    const [w0, w3] = await Promise.all([
      client.readContract({ address: PONS.poolManager, abi: EXTSLOAD_ABI, functionName: "extsload", args: [base], ...at }),
      client.readContract({ address: PONS.poolManager, abi: EXTSLOAD_ABI, functionName: "extsload", args: [liqSlot], ...at }),
    ]);
    ({ sqrtPriceX96, tick } = decodeSlot0(BigInt(w0)));
    liquidity = decodeLiquidity(BigInt(w3));
  }

  if (sqrtPriceX96 === 0n) return null;
  if (!tickMatchesSqrt(sqrtPriceX96, tick)) {
    throw new Error(
      "Layout storage PoolManager tidak sesuai dugaan (tick tidak konsisten dengan sqrtPriceX96). " +
        "Isi WEIGHHOUSE_V4_STATE_VIEW dengan alamat StateView Uniswap v4 di Robinhood Chain.",
    );
  }
  return { sqrtPriceX96, tick, liquidity };
}

const isNative = (a: string) => a.toLowerCase() === ZERO_ADDRESS;

async function holdingOfQuote(client: AnyClient, quote: `0x${string}`, holder: `0x${string}`): Promise<bigint> {
  return isNative(quote)
    ? client.getBalance({ address: holder })
    : client.readContract({ address: quote, abi: ERC20_ABI, functionName: "balanceOf", args: [holder] });
}

export async function quoteDecimals(client: AnyClient, quote: `0x${string}`): Promise<number> {
  if (isNative(quote)) return 18;
  return Number(await client.readContract({ address: quote, abi: ERC20_ABI, functionName: "decimals" }));
}

export interface QuoteReserve { raw: bigint; decimals: number; venue: "pool" | "curve" }

/**
 * Cadangan sisi quote untuk tile Liquidity (brief §4A): pool v4 kalau sudah graduation, kalau belum
 * saldo quote bonding curve. `null` = tidak bisa dihitung (bukan 0).
 * Pool: estimasi model full-range, dijaga agar tidak melebihi saldo quote PoolManager.
 */
export async function readQuoteReserve(client: AnyClient): Promise<QuoteReserve | null> {
  const key = wagePoolKey();
  const state = await readPoolState(client, key.poolId);
  const decimals = await quoteDecimals(client, key.quote);

  if (state) {
    const { quote } = fullRangeReserves(state.liquidity, state.sqrtPriceX96, key.wageIsToken0);
    const pmHolding = await holdingOfQuote(client, key.quote, PONS.poolManager);
    if (quote > pmHolding) return null; // estimasi mustahil -> ada LP non-full-range; jangan tampilkan
    return { raw: quote, decimals, venue: "pool" };
  }
  if (OPEN_ITEMS.wageCurve) {
    return { raw: await holdingOfQuote(client, key.quote, OPEN_ITEMS.wageCurve), decimals, venue: "curve" };
  }
  return null;
}
