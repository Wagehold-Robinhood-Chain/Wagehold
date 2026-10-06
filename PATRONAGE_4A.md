# Tahap 4, Sesi 4A: fondasi web3 dan panel Patronage (Dev Brief §8.2)

Mengganti panel simulasi di profil bangunan dengan panel on-chain. Tidak ada migrasi SQL dan tidak ada
perubahan route API. Tabel `stakes`/`stake_payouts` dan `lib/patronage.ts` sengaja tidak disentuh (sesi 4D).

## File

Baru
- `lib/web3/patronage-abi.ts`: ABI minimal (tanpa import). `lib/web3/patronage.ts` mengekspornya ulang.
- `lib/web3/patronage.ts`: `patronageAddress`, `computeChainAgentId`, `describePatronageError`.
- `lib/web3/patronage-rules.ts`: cek stake/unstake yang mencerminkan kontrak, format durasi cooldown.
- `lib/web3/use-patronage.ts`: `useNetworkGate`, `usePatronageBuilding`, `usePatronageActions`.
- `lib/wage-format.ts`: format dan parse $WAGE berbasis bigint.
- `lib/wording.ts`: `findForbiddenWording` dan `PATRONAGE_LABEL`.
- `components/tx-status.tsx`: status transaksi inline dengan tautan explorer (dipakai ulang di 4B).
- `scripts/test-patronage-4a.ts`, `scripts/patronage-verify-abi.ts`.

Diganti / diubah
- `components/patronage-section.tsx`: panel on-chain. Props kini hanya `agentId` dan `isLead`. `BondLine` tetap.
- `components/agent-profile.tsx`, `components/wright-profile-panel.tsx`, `components/realtime-city-dashboard.tsx`,
  `app/agents/[id]/page.tsx`: props `patronage` dan `canIdentify` ke panel dihapus.
- `.env.local.example`: variabel baru `NEXT_PUBLIC_PATRONAGE_ADDRESS`.

## Keputusan desain

- **Token dibaca dari kontrak** (`wageToken()`), bukan dari env. Approve selalu menuju token yang benar-benar
  dipakai Patronage. Desimal token dibaca dari token, tidak diasumsikan 18.
- **agentId on-chain** dihitung di browser: `keccak256(bytes(agents.id))`, rumus yang sama dengan
  `agents.chain_agent_id`. Panel tidak butuh backfill atau database.
- **Approve sebesar jumlah stake**, bukan unlimited. Setelah approve, hook menunggu allowance terlihat di RPC
  (maksimal sekitar 6 detik) sebelum meminta tanda tangan kedua.
- **Receipt dicek `status === 'success'`**. Transaksi yang mined tetapi revert ditampilkan sebagai error,
  lengkap dengan tautan.
- **Keluar selalu bisa**: claim, request unstake, dan withdraw tidak dikunci oleh `paused` atau bangunan yang
  tidak terdaftar, sama seperti kontraknya. Hanya form stake yang dinonaktifkan.
- **Tampilan jumlah dipotong, bukan dibulatkan.** Jumlah kecil tampil `<0.01 WAGE`, bukan `0`.
- **Jaringan**: wallet di chain lain mendapat tombol "Switch to <nama jaringan>". Yang diminta adalah
  `activeChain`: **46630** bila `NEXT_PUBLIC_WAGEHOLD_NETWORK` kosong/`testnet`, **4663** bila `mainnet`.
  Jadi "chain 4663" di rencana terpenuhi lewat env itu, bukan dikunci di kode.

## Jalankan

```
npx tsx scripts/test-patronage-4a.ts       # 10 kelompok uji logika murni
npx tsx scripts/patronage-verify-abi.ts    # ABI app == WageholdPatronage.sol (exit 1 bila selisih)
npm run build                              # belum pernah dijalankan untuk sesi ini, lihat bagian bawah
```

## Uji di testnet 46630

Prasyarat: kontrak ter-deploy dan batch Timelock selesai (lihat `contracts/PATRONAGE_ROLLOUT.md`).
1. Isi `.env.local`: `NEXT_PUBLIC_PATRONAGE_ADDRESS`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, jaringan testnet.
2. `registerBuilding(keccak256(bytes(agents.id)), true)` sudah dijalankan untuk Wright yang dicoba.
   Tanpa itu panel menampilkan "isn't open for new stakes".
3. Wallet uji memegang $WAGE testnet dan sedikit ETH untuk gas.
4. Buka `/agents/<id>` atau klik bangunan di kota:
   - **Stake**: ketik jumlah, "Approve & stake" (dua prompt), lalu "Stake $WAGE" pada stake berikutnya (satu prompt).
   - **Claim**: muncul setelah ada job yang disegel di bangunan itu (Splitter v2 memanggil `notifyReward`).
   - **Request unstake**: tab Unstake. Baris "Cooling down" muncul dengan hitung mundur.
   - **Withdraw**: baru aktif setelah cooldown habis. `MIN_COOLDOWN` kontrak 1 hari, jadi di testnet sungguhan
     tahap ini menunggu minimal itu (atau deploy dengan cooldown 1 hari lalu cek keesokan harinya).
5. Pindah wallet ke chain lain: panel menampilkan tombol pindah jaringan dan menonaktifkan semua aksi.

## Yang belum, dan sengaja

- Angka "Staked by patrons" dan "Patrons" di stat bar atas profil masih dari tabel simulasi sampai 4C. Selama
  itu angka di sana dan "Pool" di panel bisa berbeda; yang di panel adalah angka sebenarnya.
- Jumlah patron per bangunan tidak ada di panel (kontrak tidak menyimpannya; datanya dari indexer, dipakai 4B).
- Header (`wallet-connect.tsx`) tetap menampilkan lencana "Simulation" selama `NEXT_PUBLIC_STRONGBOX_ADDRESS`
  dan `NEXT_PUBLIC_WAGE_TOKEN_ADDRESS` kosong. Tombol Connect di dalam panel tetap berfungsi karena hanya
  bergantung pada Reown project id.
- Label "simulation" lain di kode: 4D.

## Status verifikasi (jujur)

Sandbox tanpa `node_modules` dan tanpa jaringan: `tsc`, `next build`, dan `next lint` TIDAK dijalankan.
Yang sudah diperiksa: uji logika murni (lulus), kecocokan ABI dengan Solidity (lulus, dan skripnya terbukti
bisa gagal bila ABI dirusak), parse sintaks semua file yang disentuh, dan pemindaian kata terlarang.
Belum pernah dieksekusi: seluruh pemanggilan wagmi/viem terhadap RPC sungguhan. Jalankan `npm run build`
lebih dulu; kalau ada galat tipe, kemungkinan besar di `use-patronage.ts` (inferensi tipe `useReadContracts`
dan `writeContract` dengan ABI `as const`).
