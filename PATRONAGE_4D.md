# Tahap 4, Sesi 4D: cut-over dan pembersihan (Dev Brief §7.2, §10)

Satu migrasi (`0020`), tidak ada perubahan kontrak. Setelah sesi ini simulasi Patronage tidak punya jalan tulis lagi;
tabelnya tetap ada sebagai riwayat hanya-baca.

## File

Baru
- `supabase/migrations/0020_patronage_cutover.sql`: penanda cut-over, `record_wage_split` ditulis ulang, pembekuan
  `stakes` / `stake_payouts`, `stake_wage` / `unstake_wage` dihapus, `counting_house_totals()`.
- `lib/counting-house.ts`: konversi hasil `counting_house_totals()` (murni, bisa diuji).
- `app/api/counting-house/route.ts`: GET read-only (service role, cache 30 dtk, 503 bila gagal).
- `lib/simulation-history.ts`, `components/simulation-history.tsx`: bagian "Simulation history" di profil.
- `scripts/test-patronage-4d.ts` (23 kelompok), `scripts/audit-wording.ts` + `scripts/wording-audit-lib.ts`.

Dihapus
- `app/api/agents/[id]/stake/route.ts` (stake / unstake simulasi), `lib/patronage.ts`.
  `formatWage(number)` pindah ke `lib/currency.ts` (dipakai profil, dashboard, `queries.ts`).

Diubah
- `lib/supabase/queries.ts`: `listStakes`, `listPayoutsByStaker`, `getWageSplitTotals` dihapus; ada `getBurnedTotal`
  dan `getCountingHouse`. `approveJob` tidak lagi menulis event `patrons_paid`.
- `app/page.tsx`, `components/realtime-city-dashboard.tsx`: tanpa feed "You earned" dan tanpa langganan `stake_payouts`;
  Counting House dari chain (dibaca saat render, lalu dipolling 60 dtk); gagal baca tampil "—", bukan 0.
- `components/agent-profile.tsx`, `components/wright-profile-panel.tsx`, `app/agents/[id]/page.tsx`: Simulation history
  (prop baru `viewerId`).
- `types/database.ts`, `types/domain.ts`, `README.md`, beberapa komentar.

## Apa yang dilakukan migrasi 0020

1. `patronage_cutover`: satu baris (`frozen_at`, `freeze_block`, `note`). `freeze_block` sengaja NULL; SQL tidak tahu kepala chain.
2. `record_wage_split`: tanda tangan SAMA, jadi kode lama dan baru bisa memanggilnya. Tidak lagi membaca `stakes` dan tidak
   menulis `stake_payouts`. Baris `wage_splits` baru: `treasury_redirect = 0`, `staker_count = 0` (kolom dipertahankan untuk
   baris lama). Tetap idempoten.
3. Pembekuan: trigger menolak INSERT, UPDATE, dan TRUNCATE pada `stakes` dan `stake_payouts`. DELETE sengaja TIDAK
   diblokir: `on delete cascade` dari `jobs` / `agents` (membersihkan job uji) tidak boleh ikut gagal.
4. `stake_wage` / `unstake_wage` di-drop.
5. `counting_house_totals()`: Σ `JobSplit.titheAmount` (Splitter v1 + v2) + Σ `RewardRedirected.amount`. Service role saja.

Counting House berubah arti: dulu tithe simulasi + sisa patron simulasi dari `wage_splits`; sekarang hanya yang tercatat
di chain. Angkanya akan turun setelah cut-over. Itu benar, bukan bug.

## Urutan cut-over dan nomor blok yang harus dicatat

Prasyarat: stack ter-deploy, batch Timelock selesai, env server Patronage terisi, indexer sudah menyusul.

1. **Catat sebelum apa pun** (simpan di tempat yang tahan lama):
   - Blok pembuatan Patronage, Splitter v2, Strongbox v2. Yang paling awal = `WEIGHHOUSE_PATRONAGE_DEPLOY_BLOCK`.
   - Kursor indexer: `select key, last_block from indexer_state order by key;`
   - Waktu simulasi terakhir menulis: `select max(created_at) from stake_payouts;`
2. `npx tsx --env-file=.env.local scripts/patronage-reconcile.ts` harus exit 0. Kalau tidak, berhenti: angka Counting House
   baru akan membaca indexer yang belum benar.
3. `supabase db push` (0020). Catat jam-nya. Mulai di sini simulasi beku.
4. **Catat blok pembekuan**: kepala chain sekarang (Blockscout, atau `cast block-number`), lalu
   `update patronage_cutover set freeze_block = <N>;`
5. Deploy kode 4D (Vercel). Urutan ini penting: kode 4D butuh `counting_house_totals()`; kode lama masih jalan di atas 0020
   (membaca `stakes` / `wage_splits`, memanggil `record_wage_split` dengan argumen yang sama).
6. Catat blok job pertama yang dibagi Splitter v2:
   `select min(block_number) from chain_events where event = 'JobSplit' and contract = lower('<alamat Splitter v2>');`
7. Cek (lihat "Uji di staging" di bawah).

Rollback: `alter table stakes disable trigger stakes_frozen, disable trigger stakes_frozen_truncate;` (dan dua trigger
`stake_payouts_*`), jalankan ulang `0013_stakes_furnace_bond.sql` (mengembalikan `record_wage_split` lama, `stake_wage`,
`unstake_wage`; idempoten), lalu deploy ulang kode 4C. Data simulasi tidak pernah dihapus, jadi tidak ada yang hilang.

## Yang dibuktikan, dan yang belum (jujur)

Dibuktikan di sandbox ini terhadap **Postgres 16 sungguhan** (kluster sementara, role Supabase dibuat tiruan):
- Migrasi 0001 sampai 0020 berjalan berurutan tanpa galat. Satu pengecualian yang diharapkan: 0016 butuh `pg_cron` yang tidak ada
  di kluster ini. Ini juga pertama kalinya 0019 (4C) dijalankan terhadap Postgres.
- 0020 dijalankan dua kali: tanpa galat (idempoten).
- Dengan data simulasi (2 staker, satu job `paid`) sebelum 0020: INSERT, UPDATE, dan TRUNCATE pada kedua tabel ditolak;
  `stake_wage` tidak ada lagi; `record_wage_split` baru mengembalikan `{gross, patrons, lampOil, tithe, furnace}`, menulis satu
  baris `wage_splits` (redirect 0, staker 0), TIDAK mengubah `stakes.earned` maupun `stake_payouts`; panggilan kedua null;
  persentase salah ditolak; hapus `jobs` / `agents` tetap meng-cascade ke tabel beku.
- `counting_house_totals()` menjumlahkan JobSplit v1 dan v2 serta RewardRedirected dan mengabaikan RewardNotified;
  `anon` ditolak, `service_role` boleh. `weighhouse_top_buildings` (0019) berjalan.
- Tes logika murni: 4A (10), 4B (15), 4C (25), 4D (23) lulus. `patronage-verify-abi.ts` cocok (24 entri).
  Audit kata terlarang: 202 file, 0 temuan, dan auditnya terbukti bisa gagal.

BELUM dijalankan:
- `npx tsc --noEmit`, `npm run build`, `eslint`. `npm install` ditolak di sandbox ini (registry npm tidak terjangkau, 403), jadi
  tidak ada `node_modules`. Saya menjalankan `tsc` tanpa dependensi dan menyaring galatnya: tidak ada nama hilang, impor yang
  tidak ada, atau argumen salah di file yang saya sentuh; sisanya semua akibat modul tidak terpasang atau sudah ada sebelumnya.
  Itu BUKAN pengganti `tsc` dan `build` di repomu.
- `scripts/weighhouse-verify-abi.ts` (butuh `viem`).
- Halaman di browser: Simulation history, Counting House terpolling, dashboard tanpa feed "You earned".
- Pembacaan `counting_house_totals()` lewat PostgREST (jumlah dikembalikan sebagai text; konversi diuji di 4D).

## Uji di staging (urutan)

1. `npx tsc --noEmit && npm run build` (lihat temuan 3 di bawah bila gagal di `scripts/e2e-testnet.ts`).
2. `npx tsx scripts/test-patronage-4d.ts && npx tsx scripts/audit-wording.ts`.
3. Setelah 0020: `/` menampilkan Counting House = `tithe + redirected` dari `counting_house_totals()`; `/api/counting-house` 200.
4. Seal satu job: baris `wage_splits` baru muncul, `stakes` dan `stake_payouts` tidak berubah, "Burned in the Furnace" naik.
5. Profil bangunan yang dulu punya stake simulasi: "Simulation history" muncul (tertutup); bangunan tanpa jejak: tidak muncul.
   Pengunjung yang dulu stake: baris "Yours".
6. `psql`: `insert into stakes ...` gagal dengan pesan "frozen".

## Keputusan yang perlu kamu cek

1. **"49 label simulation" tidak bisa saya cocokkan.** Di kode non-uji sebelum 4D ada 118 baris yang cocok (`simulat`, `simulasi`,
   `(sim)`). Yang memang label Patronage sekitar 15 baris (route stake, `lib/patronage.ts`, komentar, README) dan semuanya sudah
   dibersihkan. Sisanya BUKAN Patronage dan sengaja tidak saya hapus: 26 baris `simulateContract` milik viem, 21 baris di
   `scripts/e2e-testnet.ts` (hampir semuanya viem), dan sisanya menjelaskan **mode simulasi untuk escrow job** (badge
   "Simulation" di header, catatan di form Post a job, `status-check`, identitas browser `wh_sim`). Mode itu masih berfungsi
   selama `NEXT_PUBLIC_STRONGBOX_ADDRESS` kosong; menghapus labelnya akan berbohong ke user. Kalau maksudmu mode escrow
   itu juga dimatikan, itu pekerjaan terpisah (job tanpa escrow on-chain ditolak di `app/api/jobs/route.ts`) dan perlu keputusanmu.
2. **Teks §10 tidak ada di zip.** Audit kata terlarang memakai daftar di `lib/wording.ts` (istilah produk keuangan: persentase
   tahunan, imbal hasil, bunga, jaminan return). Daftar periksa penerimaan di bagian 6 `test-patronage-4d.ts` saya susun dari ringkasan 4A sampai 4D,
   bukan dari teks §10. Cocokkan satu per satu dengan brief; saya tidak bisa menyatakan "§10 terpenuhi".
3. **README memakai bahasa pemasaran** yang mungkin ingin kamu tinjau terhadap §10: "Patrons Share the Upside" dan "never
   share in what it earns". Tidak masuk daftar terlarang, jadi tidak saya ubah.
4. **Furnace di kota** ("Burned in the Furnace") masih dari `wage_splits.furnace` (10% yang DICATAT saat seal), bukan dari
   event `Burned` on-chain. Burn kontrak bersifat best-effort, jadi dua angka itu bisa berbeda. Weighhouse sudah memakai chain.
   Kamu hanya meminta Counting House dipindah, jadi Furnace tidak saya ubah.
5. **Counting House** memasukkan `RewardRedirected` begitu event-nya terindeks, sebelum `RedirectFlushed` benar-benar mengirim
   dana ke treasury. Kalau maksudmu hanya yang sudah terkirim, tambahkan `RedirectFlushed` dan kurangi.
6. **Job di mode simulasi** (tanpa escrow on-chain) tidak lagi membagi apa pun ke patron: yang tercatat hanya baris
   `wage_splits`. Tithe job simulasi tidak masuk Counting House. Wajar bila mode itu sudah hanya untuk lokal.
7. **Ledger Wall kecil di kota**: feed pribadi "You earned" dihapus (temuan 3 di 4C). Event lama `patrons_paid` yang sudah
   ada di `job_events` tetap tampil sebagai riwayat; event baru tidak dibuat lagi.
8. **Simulation history** per bangunan (bukan per user), tertutup secara default, tersembunyi bila tak ada jejak. Membaca
   `stakes` lewat client anon (RLS publik, seperti sebelumnya) dan `patronage_cutover.frozen_at` untuk tanggal.
9. Trigger beku bersifat per pernyataan: `UPDATE ... WHERE false` pun ditolak. Restore `pg_dump` ke tabel itu juga
   akan ditolak kecuali trigger dimatikan dulu.

## Temuan dari 4B dan 4C (ditutup setelah 4D)

1. **Multicall3** (4B): `usePatronageBuilding` dan `usePatronagePositions` sekarang memakai `useParallelReads` (satu `readContract`
   per panggilan, paralel, bentuk hasil sama dengan `useReadContracts`) di `lib/web3/use-patronage.ts`. Satu panggilan gagal tidak
   menggagalkan yang lain; `isError` hanya bila semuanya gagal. Belum diuji di browser.
2. **Token testnet** (4C): `takeSupplySnapshot` memakai `NEXT_PUBLIC_WAGE_TOKEN_ADDRESS` bila diisi (alamat valid), kalau tidak CA brief.
   Bila beda dari CA brief, ada `console.warn`. Di mainnet, kosongkan env itu atau isi dengan CA brief.
3. **`scripts/e2e-testnet.ts`**: pemanggilan `preparePayeeOnChain` diubah ke `{ id, wallet }`. `scripts/` tetap diperiksa tipe.
   Skrip ini belum dijalankan terhadap testnet.
4. **`PoolView.cutPer1000Staked`**: dibuang (tidak dipakai; satuannya salah). `rewardPer1000` di `lib/patronage-page.ts` tetap.

## Revisi setelah dicocokkan dengan brief (§8.3, §8.4)

1. **Kalimat Ledger Wall (§8.3):** ledger Weighhouse menampilkan kalimat di bawah badge untuk tiga jenis Patronage lewat `ledgerSentence`
   (`lib/patronage-city.ts`): "0x1234…5678 staked 5,000 WAGE on Deepdive", "240 WAGE shared with Deepdive's patrons",
   "No patrons on Gas Oracle. 60 WAGE routed to the treasury". Wallet dari `args.user` (`getLedger`). Kalimat Redirected menyebut "the treasury" (default §11); bila tujuan no-staker diganti ke burn, ubah kalimatnya.
   Feed kecil di kota membaca
   `job_events`, bukan event chain, jadi tidak berubah.
2. **README:** "Patrons Share the Upside" diganti "Patrons Share in Wages Actually Earned", ditambah "Nothing is promised."
3. **Audit kata terlarang** kini juga menangkap "passive income" dan "guaranteed" (§8.4). Migrasi 0003 dan 0008 dikecualikan: itu prompt agen
   yang melarang kata "guaranteed". Komentar Solidity "Charter guarantees" (kata benda) tidak terkena dan kontrak tidak diubah.
