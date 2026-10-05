/**
 * Matematika Uniswap v4 murni (tanpa dependensi, bisa diuji terpisah).
 *
 * Layout storage PoolManager mengikuti StateLibrary v4-core:
 *   pools[poolId] ada di slot keccak256(poolId . POOLS_SLOT), POOLS_SLOT = 6
 *   Slot0 (satu word, dari bit paling rendah): sqrtPriceX96 (160) | tick (24, signed) | protocolFee (24) | lpFee (24)
 *   liquidity aktif ada di (stateSlot + 3)
 * Layout ini DIVERIFIKASI saat runtime: tick yang dibaca harus konsisten dengan sqrtPriceX96
 * (lihat tickMatchesSqrt). Kalau tidak cocok, pembacaan ditolak -- bukan ditebak.
 */
export const Q96 = 1n << 96n;
export const POOLS_SLOT = 6n;
export const LIQUIDITY_OFFSET = 3n;

const MASK160 = (1n << 160n) - 1n;
const MASK128 = (1n << 128n) - 1n;

export function decodeSlot0(word: bigint): { sqrtPriceX96: bigint; tick: number } {
  const sqrtPriceX96 = word & MASK160;
  let tick = Number((word >> 160n) & 0xffffffn);
  if (tick >= 0x800000) tick -= 0x1000000; // sign-extend int24
  return { sqrtPriceX96, tick };
}

export const decodeLiquidity = (word: bigint): bigint => word & MASK128;

/** tick = floor(log_1.0001(price)), price = (sqrtPriceX96 / 2^96)^2. Toleransi 2 tick untuk pembulatan float. */
export function tickMatchesSqrt(sqrtPriceX96: bigint, tick: number, tolerance = 2): boolean {
  if (sqrtPriceX96 <= 0n) return false;
  const ratio = (Number(sqrtPriceX96) / Number(Q96)) ** 2;
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  return Math.abs(Math.log(ratio) / Math.log(1.0001) - tick) <= tolerance;
}

/**
 * Cadangan pool kalau SELURUH likuiditas aktif adalah posisi full-range (model Pons: posisi
 * graduation full-range yang dikunci). amount0 = L / sqrtP, amount1 = L * sqrtP.
 * Ini ESTIMASI: kalau ada LP lain dengan range sempit, hasilnya bisa lebih besar dari aslinya.
 */
export function fullRangeReserves(liquidity: bigint, sqrtPriceX96: bigint, wageIsToken0: boolean): { wage: bigint; quote: bigint } {
  const amount0 = (liquidity * Q96) / sqrtPriceX96;
  const amount1 = (liquidity * sqrtPriceX96) / Q96;
  return wageIsToken0 ? { wage: amount0, quote: amount1 } : { wage: amount1, quote: amount0 };
}

/** Harga 1 WAGE dalam unit quote (angka manusia). $WAGE selalu 18 desimal. */
export function quotePerWage(sqrtPriceX96: bigint, wageIsToken0: boolean, quoteDecimals: number): number {
  const ratio = (Number(sqrtPriceX96) / Number(Q96)) ** 2; // token1 mentah per token0 mentah
  const rawQuotePerRawWage = wageIsToken0 ? ratio : 1 / ratio;
  return rawQuotePerRawWage * 10 ** (18 - quoteDecimals);
}
