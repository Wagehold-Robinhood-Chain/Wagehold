import { WAGE_UNIT } from "@/lib/currency";

/**
 * Format & parse jumlah $WAGE on-chain (bigint base unit) -- Dev Brief §8.2.
 *
 * Aturan:
 *  - Tidak pernah lewat `number`: 18 desimal tidak muat di float, dan membulatkan ke atas bisa
 *    menampilkan lebih banyak $WAGE daripada yang dimiliki user. Tampilan selalu DIPOTONG (floor).
 *  - Jumlah > 0 yang terpotong jadi 0 tampil "<0.01 WAGE", bukan "0 WAGE", supaya reward kecil
 *    tidak tampak hilang.
 *  - File ini sengaja bebas viem/wagmi supaya bisa dipakai di server, client, dan skrip.
 */

export const DEFAULT_WAGE_DECIMALS = 18;

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export interface FormatWageOptions {
  /** Desimal token. Default 18 ($WAGE). Baca dari kontrak token bila tersedia. */
  decimals?: number;
  /** Digit pecahan maksimum yang ditampilkan (dipotong, bukan dibulatkan). Default 2. */
  maxFraction?: number;
  /** Tambahkan satuan " WAGE". Default true. */
  withUnit?: boolean;
}

/** `1844250000000000000000n` -> "1,844.25 WAGE". */
export function formatWageUnits(raw: bigint, opts: FormatWageOptions = {}): string {
  const { decimals = DEFAULT_WAGE_DECIMALS, maxFraction = 2, withUnit = true } = opts;
  const unit = withUnit ? ` ${WAGE_UNIT}` : "";

  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0");
  const fraction = frac.slice(0, Math.min(maxFraction, decimals)).replace(/0+$/, "");

  if (abs > 0n && whole === 0n && fraction === "") {
    const smallest = maxFraction > 0 ? `0.${"0".repeat(maxFraction - 1)}1` : "1";
    return `<${smallest}${unit}`;
  }
  const sign = negative ? "-" : "";
  return `${sign}${group(whole.toString())}${fraction ? `.${fraction}` : ""}${unit}`;
}

/** Presisi penuh tanpa pemotongan -- untuk tooltip / title. "1844.25 WAGE". */
export function formatWageExact(raw: bigint, decimals = DEFAULT_WAGE_DECIMALS): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${(abs / base).toString()}${frac ? `.${frac}` : ""} ${WAGE_UNIT}`;
}

export type ParseWageResult = { ok: true; value: bigint } | { ok: false; error: string };

/**
 * Teks input user -> base unit. Menerima "100", "100.5", ".5", "1,000.25".
 * Menolak: kosong, 0, negatif, notasi ilmiah, lebih dari `decimals` angka di belakang koma.
 */
export function parseWageInput(text: string, decimals = DEFAULT_WAGE_DECIMALS): ParseWageResult {
  const clean = text.trim().replace(/,/g, "");
  if (clean === "") return { ok: false, error: "Enter an amount." };
  if (!/^\d*\.?\d*$/.test(clean) || clean === ".") {
    return { ok: false, error: "Use digits only, for example 100 or 12.5." };
  }
  const [whole = "", fraction = ""] = clean.split(".");
  if (fraction.length > decimals) {
    return { ok: false, error: `At most ${decimals} digits after the decimal point.` };
  }
  const value = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (value === 0n) return { ok: false, error: "Enter an amount greater than 0." };
  return { ok: true, value };
}

/** Isi kotak input dari bigint (tombol Max): tanpa pemisah ribuan dan tanpa nol di belakang. */
export function toInputString(raw: bigint, decimals = DEFAULT_WAGE_DECIMALS): string {
  const base = 10n ** BigInt(decimals);
  const frac = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${raw / base}${frac ? `.${frac}` : ""}`;
}
