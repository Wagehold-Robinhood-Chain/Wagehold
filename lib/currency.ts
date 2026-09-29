/**
 * Simbol mata uang wage yang ditampilkan di seluruh app (UI, Ledger, prompt agent).
 *
 * Wage dibayar dengan token $WAGEHOLD. Ini murni label tampilan: token sungguhan
 * ditentukan oleh NEXT_PUBLIC_WAGE_TOKEN_ADDRESS (lihat lib/web3/strongbox.ts dan
 * .env.local.example). Selama env itu (dan NEXT_PUBLIC_STRONGBOX_ADDRESS) kosong,
 * app jalan dalam mode simulasi -- angka di layar tercatat di Postgres saja, tidak
 * ada token yang benar-benar bergerak.
 *
 * Catatan: kolom database dan field API masih bernama `budget_usdc` / `budgetUsdc`
 * (peninggalan awal proyek). Sengaja tidak di-rename supaya tidak perlu migrasi;
 * itu hanya nama, bukan mata uangnya.
 */
export const WAGE_SYMBOL = "$WAGEHOLD";
