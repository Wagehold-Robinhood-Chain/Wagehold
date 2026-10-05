export const WAGE_UNIT = "WAGE";

export function fmtWage(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
}
export const fmtWageUnit = (n: number, digits = 0) => `${fmtWage(n, digits)} ${WAGE_UNIT}`;

/** Harga token bisa sangat kecil: 4 angka signifikan (tanpa notasi eksponen). */
export function fmtPriceUsd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (n <= 0) return "$0";
  const decimals = Math.min(14, 3 - Math.floor(Math.log10(n)));
  return `$${n.toFixed(decimals)}`;
}
export function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: n >= 1e6 ? "compact" : "standard", maximumFractionDigits: n >= 1e6 ? 2 : 0 }).format(n);
}
export function fmtPct(n: number | null, digits = 1): string {
  return n == null ? "—" : `${n.toFixed(digits)}%`;
}
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
export const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
