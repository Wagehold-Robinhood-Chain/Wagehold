# Tahap 4, Sesi 4B: halaman `/patronage` (Dev Brief §8.1)

Halaman Patrons' Hall. Tidak ada migrasi SQL, tidak ada route API baru, tidak ada perubahan kontrak.
Memakai ulang hook 4A. Tabel `stakes`/`stake_payouts` dan `lib/patronage.ts` tetap tidak disentuh (4D).

## File

Baru
- `app/patronage/page.tsx`: server component. Membaca `getPools("staked")` dan `getIndexedBlock()` langsung
  (tanpa HTTP ke diri sendiri), `revalidate = 30`. Gagal baca -> tabel kosong dengan pesan, halaman tetap render.
- `components/patronage/patronage-client.tsx`: header, tabel pool, urutan, filter ward, caption, footer.
- `components/patronage/position-panel.tsx`: "Your position" dan tombol Claim all.
- `components/patronage/use-my-position.ts`: satu hook untuk wallet terhubung (panel dan kolom "Yours" memakai sumber sama).
- `lib/patronage-page.ts`: logika murni (urutan, filter, batch claim, total posisi, hitungan per 1.000 $WAGE).
- `scripts/test-patronage-4b.ts`: 15 kelompok uji.

Diubah
- `lib/web3/use-patronage.ts`: aksi `claimMany(ids)`; `agentChainId` di `usePatronageActions` kini opsional
  (aksi satu-bangunan tanpa id ditolak sebelum wallet diminta; `stake` menolak sebelum approve); hook baru
  `usePatronagePositions(ids)`.
- `components/tx-status.tsx`: label `claimMany`, dan **perbaikan galat tipe dari 4A** (lihat bawah).
- `components/site-nav.tsx`: tautan "Patronage" di antara Job Board dan Weighhouse.
- `lib/web3/addresses.ts`: `explorerBlock(n)`. `lib/wording.ts`: label `claimAll`, `claimedToDate`.

## Perilaku

- **Your position**: stake, patron rewards, cooldown dibaca LIVE dari kontrak lewat satu multicall
  (`stakeOf`/`cooldownOf`/`pendingRewards` untuk tiap bangunan di daftar pool, ditambah bangunan yang hanya
  dikenal indexer lewat `/api/patronage/me`). "Claimed so far" dari indexer (tertinggal beberapa menit, dan tertulis begitu).
- **Claim all** = satu transaksi `claimMany`, hanya bangunan dengan pending > 0, terbesar dulu, maksimal 30 per
  transaksi (`MAX_CLAIM_BATCH`). Kalau lebih, UI memberi tahu dan sisanya diklaim di tekanan berikutnya.
  Tetap aktif saat kontrak di-pause (sama dengan kontrak).
- **Tabel**: data dari `/api/patronage/pools` (dimuat ulang tiap 60 dtk, dilewati saat tab tersembunyi).
  Urutan ("Most staked", "Most wages sealed") dan filter ward dikerjakan di browser dari data yang sama, jadi instan.
  Kolom 7 hari ("Wages sealed", "Paid to patrons", "Per 1,000 staked") berada di bawah kepala kelompok
  **"Past 7 days, not a forecast"**, dan caption yang sama ada di bawah tabel. Kolom "Yours" muncul hanya bila
  wallet punya posisi.
- **Label blok**: "Table data runs up to block N" (tautan Blockscout) supaya jelas tabel tertinggal dari chain.
- **Footer**: alamat Patronage (yang dipanggil wallet user), Splitter v2, Strongbox v2 dengan tautan Blockscout,
  dan disclaimer. Token $WAGE sengaja tidak ditampilkan: alamat yang benar dibaca dari `wageToken()`, bukan konstanta mainnet.
- Wallet salah jaringan: tombol "Switch to <jaringan>" (dari `useNetworkGate`). Wallet belum terhubung: tombol Connect.

## Keputusan / penyimpangan yang perlu kamu ketahui

1. **`PoolView.cutPer1000Staked` tidak dipakai.** Rumus di `lib/patronage-onchain.ts` (`notified * 1000 / staked`)
   menghasilkan jumlah $WAGE UTUH, bukan base unit seperti komentarnya, dan membuang pecahan: 0,5 WAGE per
   1.000 tampil 0. Halaman menghitung ulang dari `paidToPatrons7d` dan `totalStaked` (`rewardPer1000`, diuji).
   API tidak saya ubah (kontrak responsnya milik Tahap 3); sebaiknya diperbaiki atau field itu dibuang.
2. Tabel memakai 18 desimal (`DEFAULT_WAGE_DECIMALS`); panel posisi memakai desimal yang dibaca dari token.
3. Staking sendiri tidak ada di halaman ini; baris bangunan menaut ke profilnya (panel 4A).
4. Dua env alamat harus sama: `NEXT_PUBLIC_PATRONAGE_ADDRESS` (browser/wallet) dan `WEIGHHOUSE_PATRONAGE_ADDRESS`
   (indexer/tabel). Bila berbeda, server mencatat peringatan di log saat halaman dirender.
5. Isi kolom dan label saya susun dari ringkasan sesi; teks §8.1 sendiri tidak ada di zip. Cocokkan dengan brief.

## Dua masalah yang ditemukan (bukan dari sesi ini)

- **4A: `components/tx-status.tsx` tidak lolos `tsc`** (`tx.message` pada union yang belum menyempit). Sudah diperbaiki di sini
  dengan satu cek eksplisit. Tanpa itu `npm run build` gagal.
- **`scripts/e2e-testnet.ts` tidak lolos `tsc`** (6 galat): memanggil `preparePayeeOnChain(uuid, alamat)` padahal
  `lib/web3/council.ts` kini meminta `{ id, wallet }`. `tsconfig.json` mencakup `scripts/`, jadi `next build` ikut gagal.
  TIDAK saya ubah karena saya tidak tahu agent id mana yang dimaksud skrip itu. Perlu diputuskan: perbaiki skrip,
  atau tambahkan `scripts` ke `exclude`.

## Jalankan

```
npx tsx scripts/test-patronage-4b.ts       # 15 kelompok uji logika murni
npx tsx scripts/test-patronage-4a.ts       # regresi 4A
npx tsx scripts/patronage-verify-abi.ts    # ABI app == WageholdPatronage.sol
npx tsc --noEmit                           # bersih kecuali scripts/e2e-testnet.ts (lihat atas)
```

## Uji di testnet 46630

Prasyarat sama dengan 4A, ditambah indexer berjalan (`WEIGHHOUSE_PATRONAGE_*`, cron `index-chain`).
1. Buka `/patronage` tanpa wallet: tabel tampil, "Your position" meminta Connect.
2. Hubungkan wallet yang sudah stake di dua bangunan atau lebih; tunggu satu job disegel di masing-masing.
3. "Patron rewards" harus sama dengan jumlah `pendingRewards` per bangunan; tekan **Claim all**: satu prompt wallet,
   satu transaksi, status inline dengan tautan Blockscout, angka menyusul sendiri.
4. Ganti urutan dan filter ward; kolom "Yours" hanya muncul untuk bangunan yang kamu stake.
5. Pindahkan wallet ke chain lain: panel menampilkan tombol pindah jaringan dan Claim all hilang.

## Status verifikasi (jujur)

Dijalankan di sandbox ini (kali ini `npm install` berhasil): `tsc` (bersih kecuali e2e di atas), `eslint` pada semua
file yang disentuh (bersih), ketiga skrip uji di atas (lulus), `next build` (lulus, `/patronage` terdaftar; font
Google di-stub sementara karena sandbox tidak bisa mengunduhnya, lalu `layout.tsx` dan `tsconfig.json` dipulihkan),
dan `next start` + `curl /patronage` tanpa env: 200 dengan "Your position", "isn't live on this network yet",
caption, disclaimer, dan tautan nav.

BELUM pernah dijalankan: halaman di browser dengan wallet, pemanggilan wagmi/viem ke RPC sungguhan (multicall
posisi dan `claimMany`), serta tabel dengan data indexer nyata. Itu yang diuji di langkah testnet di atas.
