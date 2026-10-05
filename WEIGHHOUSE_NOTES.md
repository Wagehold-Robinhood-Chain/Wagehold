# Weighhouse — catatan implementasi (Dev Brief v1.0, revisi 2)

Zip ini adalah **overlay**: salin ke root repo `wagehold/` (`.env.local` dan `contracts/.env` tidak disentuh).

## Langkah menjalankan
1. `supabase db push` — menjalankan `0014_weighhouse.sql` **dan** `0015_weighhouse_market.sql`.
2. `npx tsc --noEmit && npx eslint .` — **wajib dijalankan di repo**: revisi 2 belum pernah di-type-check (lihat "Status verifikasi").
3. `npx tsx --env-file=.env.local scripts/weighhouse-preflight.ts` — token app = Strongbox = Splitter = `0x1946…f2c8`.
4. `npx tsx scripts/weighhouse-verify-abi.ts` — signature event (Foundry ABI + topic0 Pons dari dokumentasi Bitquery).
5. `npx tsx --env-file=.env.local scripts/weighhouse-discover.ts` — membaca chain dan **mencetak baris env siap-tempel**:
   `WEIGHHOUSE_DEPLOY_BLOCK`, `WEIGHHOUSE_WAGE_CURVE`, `WEIGHHOUSE_PAIR_TOKEN`, `NEXT_PUBLIC_WAGE_GRADUATED_AT`.
   Skrip juga membuktikan pool ID terhadap event `Initialize` dan memeriksa layout storage PoolManager.
6. Isi `.env.local` + Vercel: hasil langkah 5, `CRON_SECRET`, dan (disarankan) `BITQUERY_API_KEY`.
7. `npx tsx --env-file=.env.local scripts/weighhouse-backfill-job-ids.ts` — isi `jobs.chain_job_id` untuk job lama.
8. Deploy, lalu jadwalkan indexer lewat **Supabase** (bukan Vercel Cron; `vercel.json` dihapus): `supabase db push` menjalankan `0016_weighhouse_cron.sql`. Isi dulu 2 secret Vault di SQL Editor: `select vault.create_secret('https://DOMAIN-APP', 'weighhouse_app_url');` dan `select vault.create_secret('<CRON_SECRET>', 'weighhouse_cron_secret');`. pg_cron lalu memanggil `/api/cron/index-chain` tiap menit. Cek: `select * from cron.job_run_details order by start_time desc limit 10;` dan `select status_code, content from net._http_response order by created desc limit 5;` (JSON-nya: `work`, `market`, `price.errors`).

## Yang berubah di revisi 2 (item "belum selesai" di revisi 1)
| Item | Sekarang |
|---|---|
| Adapter Bitquery | **Ditulis.** Satu query cube `Trading` (trade terakhir token, `PriceInUsd`, `Price`) — bentuknya mengikuti contoh di dokumentasi Pons-nya Bitquery. Cube ini menyatukan curve (`pons_v2`) dan pool v4, jadi harga pra- dan pasca-graduation lewat query yang sama. |
| Trade bonding curve di Work Ratio | **Masuk, tanpa Bitquery.** Indexer membaca `CurveBuy`/`CurveSell` langsung dari kontrak curve (sisi WAGE: `tokensOut` / `tokensIn`). Penyebut = curve + `Swap` pool v4, semuanya event on-chain (migrasi 0015, fungsi `weighhouse_trade_volume`). `price_snapshots.volume_wage` sekarang null → tidak ada hitung ganda. |
| Pool ID v4 | **Dihitung otomatis**: `keccak256(abi.encode(currency0, currency1, 0, 200, memeHook))` — fee/tickSpacing/hook tetap untuk semua pool Pons (dokumentasi Bitquery). `WEIGHHOUSE_V4_POOL_ID` jadi override opsional. Skrip discover membuktikannya terhadap event `Initialize`. |
| StateView | **Tidak wajib.** State pool dibaca lewat `PoolManager.extsload`; tick yang dibaca harus konsisten dengan `sqrtPriceX96`, kalau tidak pembacaan ditolak dengan pesan jelas (lalu isi `WEIGHHOUSE_V4_STATE_VIEW`). |
| Graduation | `PoolGraduated` diindeks → garis vertikal grafik harga otomatis (`NEXT_PUBLIC_WAGE_GRADUATED_AT` hanya fallback). |
| LP pool | **Estimasi** dari likuiditas aktif pool dengan model full-range (desain Pons: satu posisi full-range terkunci). 0 sebelum graduation; `null` ("Not tracked yet") kalau gagal baca atau estimasi melebihi saldo WAGE PoolManager. Badge: "Estimated (full-range pool)". |
| Liquidity (USD) | Cadangan quote on-chain (saldo curve pra-graduation, pool pasca-graduation) × kurs USD quote yang diturunkan dari trade Bitquery (`PriceInUsd / Price`). Kosong kalau tidak ada kurs. |
| `WEIGHHOUSE_WAGE_IS_TOKEN0` | Dihapus: diturunkan dari urutan alamat. |
| Aliran indexer | Dua aliran dengan cursor sendiri: kerja (Strongbox + Splitter, dari `DEPLOY_BLOCK`) dan pasar (curve + pool + graduation, dari `WEIGHHOUSE_MARKET_START_BLOCK` ?? `DEPLOY_BLOCK`). Cursor pasar memuat alamat curve + pool ID, jadi mengisi `WAGE_CURVE` belakangan tidak melewatkan event lama. |

## Yang masih butuh manusia / tidak bisa dipastikan dari sini
- **Menjalankan `weighhouse-discover.ts`** — butuh RPC Anda. Hasilnya (blok deploy, alamat curve, status graduation) belum diketahui siapa pun di sini.
- **`BITQUERY_API_KEY`** (akun Bitquery). Header memakai `Authorization: Bearer <token>`; cube `Trading` menyimpan ±30 hari. Cek run pertama: `price.impliedQuoteUsd` di JSON cron harus ≈ harga ETH kalau quote = ETH. Tanpa key: harga on-chain, **hanya pasca-graduation** (pra-graduation tidak ada fallback; rumus curve tidak dipublikasikan, snapshot dilewati).
- **Link Pons**: tidak ada format URL halaman token Pons yang bisa diverifikasi (hanya root `ponsfamily.com/launchpad`). Tetap lewat `NEXT_PUBLIC_PONS_TOKEN_URL`.
- **Alamat Pons/Uniswap v4**: kelima alamat di brief identik dengan tabel kontrak di dokumentasi Pons-nya Bitquery (yang mengklaim memverifikasi dengan kemunculan on-chain). Itu sumber kedua, bukan Blockscout — cek sekali di Blockscout sebelum production.
- **§7** (muat <1,5 dtk, ledger ≤2 menit, Work Ratio vs hitungan manual, 390px): uji di staging.

## Keputusan/batasan yang perlu Anda ketahui
- **"All" window**: penyebut dihitung sejak `WEIGHHOUSE_MARKET_START_BLOCK` (default `DEPLOY_BLOCK`). Kalau $WAGE diperdagangkan sebelum Strongbox di-deploy dan Anda ingin itu masuk, isi blok launch (dicetak skrip discover) — backfill lebih lama (blok ±100 ms; ~20 chunk/menit).
- **LP pool = estimasi** (lihat tabel). Kalau ada LP non-full-range, hasilnya bisa terlalu besar; penjaga saldo PoolManager hanya menangkap kasus yang mustahil.
- **Hook Pons menyimpan fee dalam token** (dokumentasi Bitquery); jumlahnya tidak punya bucket sendiri dan ikut "Circulating".
- **Sealed** = `SealSet` + bagian payee `DisputeResolved` (keputusan revisi 1; ubah di `weighhouse_flow` kalau hanya `SealSet`).
- **Furnace**: total burned = saldo dEaD; `JobSplit` = dibukukan, `Burned` = benar-benar dikirim. "Pending split / burn" = `balanceOf(Splitter)` (juga memuat bagian patron/Lamp Oil/Tithe yang belum di-`withdraw()`).
- **Circulating** = sisa, jadi cek "bucket = totalSupply" selalu lolos; yang berguna adalah peringatan konsol kalau Circulating < 0.
- `weighhouse_swap_volume` (0014) tetap ada tapi tidak dipakai lagi; boleh di-drop.

## Status verifikasi (jujur)
- **Lolos di sandbox**: sintaks semua file TS yang diubah; 13 tes unit `v4math.ts` (decode slot0 termasuk tick negatif, penjaga layout, cadangan full-range, konversi harga untuk quote 18/6 desimal); keccak-256 dari 6 signature Pons cocok dengan topic0 di dokumentasi.
- **Belum**: `tsc --noEmit` dan ESLint untuk perubahan revisi 2 (sandbox tidak punya repo/viem). Revisi 1 lolos keduanya; revisi 2 harus dijalankan ulang.
- **Belum**: eksekusi terhadap Supabase, RPC, atau Bitquery nyata. Asumsi layout `extsload` (POOLS_SLOT=6, liquidity di offset 3) dijaga oleh pengecekan runtime, bukan dibuktikan di sini.
