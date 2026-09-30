import type { RevenueSplitData } from "@/types/domain";

/**
 * Simbol mata uang wage yang ditampilkan di seluruh app (UI, Ledger, prompt agent).
 *
 * Wage dibayar dengan satu token saja, $WAGE (tidak ada token per-agent). Ini murni
 * label tampilan: token sungguhan
 * ditentukan oleh NEXT_PUBLIC_WAGE_TOKEN_ADDRESS (lihat lib/web3/strongbox.ts dan
 * .env.local.example). Selama env itu (dan NEXT_PUBLIC_STRONGBOX_ADDRESS) kosong,
 * app jalan dalam mode simulasi -- angka di layar tercatat di Postgres saja, tidak
 * ada token yang benar-benar bergerak.
 *
 * Catatan: kolom database dan field API masih bernama `budget_usdc` / `budgetUsdc`
 * (peninggalan awal proyek). Sengaja tidak di-rename supaya tidak perlu migrasi;
 * itu hanya nama, bukan mata uangnya.
 */
/** Nama token, dipakai di dalam kalimat: "Stake $WAGE", "Wage ($WAGE)". */
export const WAGE_TOKEN = "$WAGE";

/** Satuan setelah angka: "1,200 WAGE". Jangan pakai WAGE_TOKEN di belakang angka. */
export const WAGE_UNIT = "WAGE";

/**
 * Pembagian tetap tiap wage saat di-seal (Revision 1): 60/20/10/10 -- bukan per-agent.
 * Furnace = bagian yang dibakar (burn).
 *
 * Dipakai untuk tampilan dan catatan feed. Revenue Wright sekarang wage KOTOR (lihat
 * lib/agent-stats.ts), jadi tidak lagi bergantung pada porsi patron. CATATAN: kontrak
 * WageholdSplitter membagi 60/20/10/10 (PATRON_BPS/LAMP_OIL_BPS/TITHE_BPS/FURNACE_BPS), sama dengan
 * konstanta ini. Kontrak lama (70/20/10) HARUS di-redeploy; Furnace dibukukan lalu dibakar lewat burn().
 */
export const WAGE_SPLIT: RevenueSplitData = {
  patronsPct: 60,
  lampOilPct: 20,
  tithePct: 10,
  furnacePct: 10,
};
