/**
 * Aturan kata Patronage (Dev Brief §8.2, §10).
 *
 * Patron rewards adalah BAGIAN dari upah yang benar-benar disegel dan dibagi, bukan bunga atau
 * imbal hasil yang dijanjikan. Karena itu UI, API, dan komentar yang tampil ke user tidak boleh
 * memakai kosakata produk keuangan. Daftar mengikuti §8.4: "yield", "APY" (dan "APR"), "earn passive income",
 * "guaranteed". Disclaimer ditulis tanpa kata itu ("Nothing is promised"), bukan "nothing is guaranteed". Angka historis selalu diberi caption "Past 7 days, not a
 * forecast" (dipakai di sesi 4B).
 *
 * `findForbiddenWording` dipakai oleh audit kata terlarang di sesi 4D; file ini sendiri harus
 * dikecualikan dari audit itu karena memuat daftarnya.
 */

const FORBIDDEN = /\b(apr|apy|yield(?:s|ed|ing)?|interest rate|passive income|guaranteed|guaranteed returns?)\b/gi;

/** Semua kata terlarang yang ditemukan di `text` (kapitalisasi asli), kosong bila bersih. */
export function findForbiddenWording(text: string): string[] {
  return Array.from(text.matchAll(FORBIDDEN), (m) => m[0]);
}

/** Label bersama supaya panel profil, halaman /patronage, dan tooltip memakai istilah yang sama. */
export const PATRONAGE_LABEL = {
  staked: "Staked",
  pendingRewards: "Patron rewards",
  cooling: "Cooling down",
  walletBalance: "In your wallet",
  claim: "Claim",
  requestUnstake: "Request unstake",
  withdraw: "Withdraw",
  historical: "Past 7 days, not a forecast",
  claimAll: "Claim all",
  claimedToDate: "Claimed so far",
} as const;
