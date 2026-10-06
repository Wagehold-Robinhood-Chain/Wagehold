# Tahap 4, Sesi 4C: kota dan Weighhouse (Dev Brief §8.3)

Satu migrasi (`0019`), tidak ada perubahan kontrak. Tabel `stakes` / `stake_payouts`, `record_wage_split`, dan
`lib/patronage.ts` TIDAK disentuh (4D). Counting House masih membaca `wage_splits` (simulasi) sampai 4D.

## File

Baru
- `supabase/migrations/0019_weighhouse_patronage.sql`: kolom `supply_snapshots.patronage`; `weighhouse_top_buildings`
  diganti (drop + create) dengan `staked` dari `building_pools.total_staked` (on-chain), tipe kolom `text`.
- `lib/web3/use-patron-buildings.ts`: hook `usePatronBuildings(agentIds)` (cincin emas). Baca `stakeOf` per bangunan.
- `components/patronage/use-onchain-pools.ts`: stake + jumlah patron per bangunan dari `/api/patronage/pools`.
- `lib/patronage-city.ts`, `lib/weighhouse/supply-math.ts`, `lib/weighhouse/sol-events.ts`: logika murni (bisa diuji).
- `scripts/test-patronage-4c.ts`: 25 kelompok uji.

Diubah
- `components/city-scene.tsx`: prop `patronIds`, cincin emas per gedung.
- `components/realtime-city-dashboard.tsx`, `app/page.tsx`: cincin; stat bar profil dari on-chain; langganan
  Realtime `stakes` dan prop `initialStakes` dilepas.
- `app/agents/[id]/page.tsx`: "Staked by patrons" / "Patrons" dari `getPool()` (indexer), bukan tabel simulasi.
- `lib/weighhouse/metrics.ts`, `types/database.ts`: ringkasan Patronage, bucket baru, ledger dengan nama bangunan.
- `lib/weighhouse/events.ts`: tiga event Patronage masuk `LEDGER_EVENT_NAMES`, label kind baru.
- `lib/weighhouse/supply.ts`: saldo Strongbox v2, Splitter v2, dan kontrak Patronage ikut dibaca.
- `components/weighhouse/weighhouse-client.tsx`: baris "Staked by patrons" / "Patron rewards paid", tabel top
  buildings tanpa "(sim)", ledger dengan kolom Building.
- `scripts/weighhouse-verify-abi.ts`: sekarang juga memeriksa Strongbox v2, Splitter v2, dan Patronage.

## Perilaku

- **Cincin emas**: torus di dasar gedung yang stake-nya dipegang wallet terhubung (`stakeOf > 0`). Memudar masuk
  dan keluar, berdenyut pelan, diam bila reduced motion. Header panel kota menambah petunjuk "gold ring: you are a
  patron here" hanya bila ada cincin. Dibaca langsung dari kontrak (live), tiap 60 dtk, dan saat tab kembali
  terlihat. Bacaan yang gagal mempertahankan status sebelumnya, jadi cincin tidak berkedip.
- **Tanpa multicall**: hook ini memakai `readContract` paralel, bukan `useReadContracts`. Lihat temuan 1.
- **Weighhouse, Supply**: bucket baru "Patronage" (saldo kontrak: stake + cooldown + reward belum diklaim).
  Tanpa itu $WAGE yang di-stake ikut terhitung "Circulating". Strongbox/Splitter v2 dijumlahkan ke bucket
  Strongbox/Splitter (tautan Blockscout memuat v1 dan v2). Dua baris memo di bawah tabel:
  "Staked by patrons (on-chain)" dan "Patron rewards paid (all time)" + "X redirected to treasury".
  Patronage belum dikonfigurasi -> "isn't live on this network yet", bukan angka 0.
- **Ledger**: tiga baris baru: `Staked`, `Patron reward` (RewardNotified), `Redirected` (RewardRedirected),
  dengan nama bangunan (juga untuk Split/Registered dari Splitter v2) dan tooltip penjelasan.
- **Top buildings**: kolom Staked = stake on-chain sekarang (bukan jendela waktu), sumber `building_pools`.

## Urutan menjalankan

1. `supabase db push` (0019). Aman dijalankan ulang.
2. Isi env server Patronage (sudah ada dari Tahap 3) agar cron snapshot membaca saldo v2 + Patronage.
3. `npx tsx scripts/test-patronage-4c.ts` dan `npx tsx scripts/weighhouse-verify-abi.ts`.
4. `npx tsc --noEmit && npm run build`.

## Keputusan / penyimpangan yang perlu kamu ketahui

1. **Bucket "Patronage" di supply tidak ada di ringkasanmu.** Saya menambahnya karena tanpa itu "Circulating"
   salah (stake dihitung beredar). Ini juga alasan kolom `patronage` di migrasi.
2. **"Patron rewards paid (termasuk total redirect)"** saya baca sebagai: angka utama = Σ `RewardNotified`
   (benar-benar dibagi ke patron), dengan total `RewardRedirected` di baris yang sama. Bila maksudmu satu angka
   gabungan, ubah satu baris di `PatronageMemoRows`.
3. **"Ledger Wall"** saya artikan sebagai ledger on-chain Weighhouse (yang memakai `PATRONAGE_LEDGER_EVENT_NAMES`).
   Ledger Wall kecil di kota (`job_events` + "You earned") tidak diubah; itu sumber simulasi, urusan 4D.
4. **Stat bar profil** ("Staked by patrons", "Patrons"): 4A menjanjikannya di 4C, jadi sekalian dipindah ke on-chain
   (indexer). Gagal baca = tampil 0 (bukan "—"), karena tipe `AgentDetail` berupa number.
5. Total Patronage di Weighhouse bersifat SEMUA WAKTU dan tidak mengikuti pemilih jendela (24h/7d/All).
6. Hanya `staked > 0` yang mendapat cincin; posisi yang sedang cooldown tidak.

## Temuan di luar 4C

1. **Multicall3 (berlaku untuk 4B).** `supply.ts` sudah mencatat bahwa definisi chain Robinhood tidak memuat
   Multicall3. `usePatronagePositions` (4A/4B) memakai `useReadContracts`, yang memanggil multicall. Bila RPC-mu
   tidak punya Multicall3 di alamat yang didaftarkan chain, "Your position" dan Claim all akan gagal baca. Belum
   terbukti dari sini. Cek di langkah uji 4B; bila gagal, ganti ke `readContract` paralel seperti hook 4C.
2. **Token testnet.** `supply.ts` dan `weighhouse` memakai `ADDRESSES.wageToken` (konstanta mainnet). Di stack 46630
   dengan token lain, snapshot supply membaca token yang salah. Tidak saya ubah.
3. `scripts/e2e-testnet.ts` (temuan 4B no. 2) tetap memblokir `npm run build`; belum diputuskan.

## Status verifikasi (jujur)

Sandbox ini TIDAK punya `node_modules` dan tidak ada jaringan, jadi `npm run build`, `tsc` penuh, dan `eslint`
TIDAK bisa dijalankan. Yang dijalankan:
- `scripts/test-patronage-4c.ts`: 25 kelompok lulus. 4A (10) dan 4B (15) tetap lulus.
- Event app vs kontrak dibandingkan dari source Solidity untuk Strongbox v1/v2, Splitter v1/v2, Patronage: cocok,
  dan pembandingnya terbukti bisa gagal (tipe, `indexed`, nama argumen, event hilang).
- `tsc` dengan tipe pihak ketiga tidak ada: tidak ada galat sintaks; galat yang tersisa semuanya karena modul
  tidak terpasang. Itu BUKAN pengganti `tsc` di repomu.

BELUM pernah dijalankan: migrasi 0019 terhadap Postgres; render cincin di browser (three.js); `stakeOf` ke RPC
sungguhan lewat client wagmi; halaman Weighhouse dengan data indexer nyata. Langkah uji:
1. Wallet yang sudah stake di 2 bangunan: buka `/`, cincin emas muncul di dua gedung itu saja dalam beberapa detik.
2. Request unstake penuh di salah satu: cincin hilang setelah polling berikutnya (<= 60 dtk) atau reload.
3. Putuskan wallet: semua cincin memudar. Ganti wallet: tidak ada cincin wallet lama.
4. `/weighhouse`: "Staked by patrons" = jumlah `stakeOf` semua pemegang; "Patron rewards paid" naik setelah job disegel.
5. Setelah snapshot supply berikutnya: bucket "Patronage" ≈ total stake + reward belum diklaim; "Circulating" turun
   sebesar itu; selisih bucket (sum gap) tetap ~0.
6. Ledger: baris Staked / Patron reward / Redirected tampil dengan nama bangunan.
