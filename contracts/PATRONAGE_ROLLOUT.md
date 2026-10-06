# Patronage build, Tahap 2: Strongbox v2 + hardening (H1-H4, H6) + rollout

> Status: **ditulis tetapi belum dikompilasi atau dites.** Sandbox tempat file ini dibuat tidak punya
> `forge`/`solc`/internet. Jalankan `forge build && forge test` (lihat langkah 1) sebelum apa pun.

## Peta peran setelah tahap 2

| Peran | Siapa | Bisa apa | Tidak bisa |
|---|---|---|---|
| **Client** | wallet pemilik job | `createJob`, `approve` (seal), `refund`, `dispute` | apa pun di luar jobnya sendiri |
| **Registrar** | kunci panas di server | `Strongbox v2.setPayee` (hanya ke allow-list = Splitter v2), `Splitter v2.registerJob` (hanya building terdaftar) | resolve dispute, ubah role, ubah allow-list, sentuh stake/reward |
| **Council** | Safe (dispute) | `Strongbox v2.resolveDispute` (dibatasi ke payee+client job itu) | `setPayee`, role, parameter |
| **Owner** | `WageholdTimelock` (proposer = Safe owner, delay 48 jam) | role, allow-list, `setSplitter`, `setCooldown`, treasury, `registerBuilding`, `setGuardian`, unpause | memindahkan $WAGE staked/reward (tidak ada fungsinya) |
| **Guardian** (opsional) | kunci cepat | `Patronage.pause()` saja (hanya memblokir stake baru) | unpause, setter apa pun, dana |
| **Siapa saja** | | `pullAndSplit`, `flushRedirect`, `burn`, eksekusi operasi timelock yang sudah lewat delay | |

Pemetaan ke brief: **H1** Owner = Safe di belakang timelock. **H2** Registrar vs Council dipisah di
Strongbox v2 (`setPayee` vs `resolveDispute`). **H3** `setPayee` hanya ke allow-list dan
`registerJob` hanya ke building terdaftar. **H4** `WageholdTimelock` (lantai 24 jam, default 48 jam).
**H5** audit eksternal: belum, lihat checklist. **H6** rotasi kunci: lihat bagian bawah.

## 1. Build dan tes di mesinmu

```bash
cd wagehold/contracts
# taruh dulu file tahap 1 (src/WageholdPatronage.sol versi tahap 1 akan ditimpa file ini,
# src/WageholdSplitterV2.sol, src/interfaces/, test/*, test/mocks/*) lalu salin file tahap 2 di atasnya.
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts   # jika lib/ belum ada
forge build
forge test -vvv --fuzz-runs 10000
slither .
```

Yang perlu kamu perhatikan kalau ada yang merah: file tahap 2 ditulis tanpa kompiler. Titik paling
mungkin bermasalah: `WageholdTimelock` (override `getMinDelay`, API OZ v5.x), pemakaian
`vm.envOr(name, delim, string[])` di script, dan tes yang memakai `expectRevert()` tanpa selector
pada operasi timelock (OZ membungkus revert dalam).

## 2. Testnet 46630

```bash
export WAGE_TOKEN_ADDRESS=            # kosong => MockWAGE (hanya non-mainnet)
export REGISTRAR_ADDRESS=0x...        # wajib, harus beda dari COUNCIL_ADDRESS
export GUARDIAN_ADDRESS=0x...         # opsional
export TIMELOCK_DELAY=86400           # testnet boleh 24 jam (lantai kontrak)
export BUILDING_UUIDS=uuid1,uuid2,... # id agents (lowercase, persis seperti di Postgres)
forge script script/DeployPatronageStack.s.sol --rpc-url robinhood_testnet --broadcast
```

Script men-deploy Timelock, Strongbox v2, Patronage, Splitter v2; wiring dikerjakan saat deployer masih
owner sementara (belum ada dana); lalu `transferOwnership` ke Timelock untuk ketiganya. **Owner baru
efektif setelah Timelock menerima**: Safe owner men-`scheduleBatch` tiga panggilan `acceptOwnership()`
(payload dicetak script), tunggu delay, siapa saja `executeBatch`. Cek `owner()` ketiga kontrak
= alamat Timelock.

`agentId` selalu `keccak256(bytes(agentUuid))` dengan string UUID persis seperti di `agents.id`
(lowercase). Indexer, frontend, dan `BUILDING_UUIDS` harus memakai string yang sama.

Uji alur end to end di testnet: post job -> lock -> `seal/prepare` (Registrar) -> seal (wallet) ->
`pullAndSplit` -> `claim` patron. Uji juga: kunci Registrar tidak bisa `setPayee` ke alamat lain;
`resolveDispute` dari Registrar ditolak; operasi timelock tidak jalan sebelum delay; guardian bisa
pause tetapi `claim` dan `withdraw` tetap jalan.

## 3. Cut-over app: **drain lalu pindah** (keputusan yang kamu perlu konfirmasi)

App hari ini punya satu konstanta `NEXT_PUBLIC_STRONGBOX_ADDRESS` yang dipakai `lock-wage`,
`set-the-seal`, `verify-lock`, dan `verify-release`. Karena itu kode tahap 2 mendukung **satu
Strongbox pada satu waktu**:

1. Hentikan job baru di v1 (matikan Post a Job sebentar atau pasang notice).
2. Tunggu semua job v1 selesai: Released atau Refunded, dan semua yang Released sudah `pullAndSplit` di
   Splitter v1 (siapa saja bisa memanggilnya langsung ke kontrak v1 jika ada `split_pending`).
3. Set env: `NEXT_PUBLIC_STRONGBOX_ADDRESS` (v2), `WAGEHOLD_SPLITTER_ADDRESS` (Splitter v2),
   `WAGEHOLD_SPLITTER_VERSION=2`, `REGISTRAR_PRIVATE_KEY`. Hapus `COUNCIL_PRIVATE_KEY` dari server.
   Catat **cut-over block** untuk indexer.

Alternatif sesuai brief persis ("job baru ke v2, job lama selesai di v1 secara paralel") butuh kolom
`jobs.escrow_contract` dan keempat file di atas membaca alamat per job. Itu pekerjaan tambahan
sekitar satu tahap; belum dikerjakan.

## 4. Mainnet (urutan)

1. Buat dua Safe (Owner 2-of-3 hardware signer, Council) dan satu kunci Registrar baru (EOA, sedikit ETH gas,
   hanya di secret manager server). Guardian opsional.
2. Dry run script di testnet dengan konfigurasi yang sama.
3. `forge script ... --rpc-url robinhood_mainnet --account wagehold-deployer --sender 0x... --broadcast`
   (keystore atau Ledger; **jangan** isi `DEPLOYER_PRIVATE_KEY`). Script menolak mainnet jika Safe bukan
   kontrak, council = registrar, atau token tanpa kode.
4. Safe owner: `scheduleBatch` acceptOwnership x3 -> tunggu 48 jam -> eksekusi. Verifikasi `owner()`.
5. Verifikasi semua kontrak di Blockscout (`--verifier blockscout`), publikasikan alamat.
6. Lakukan bagian 3 (drain lalu pindah), lalu pantau 72 jam (`RewardNotified` dan `RewardRedirected` cocok
   dengan job yang di-seal).
7. **Jangan arahkan dana pengguna ke kontrak baru sebelum langkah 4 selesai.** Selama itu deployer
   masih owner.

## 5. H6: rotasi kunci

- `COUNCIL_PRIVATE_KEY` lama (council Strongbox v1 / Splitter v1 di mainnet) dan nilai di `.env.local`
  yang ikut ter-zip dan ter-upload ke chat: anggap terbuka. Rotasi setelah job v1 terakhir selesai
  (Strongbox v1 `setCouncil` oleh owner v1) dan tentu sebelum itu bila ada indikasi penyalahgunaan.
- Juga rotasi `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `BITQUERY_API_KEY`, `CRON_SECRET`.
- Setelah cut-over, `COUNCIL_PRIVATE_KEY` tidak boleh ada di environment mana pun. Registrar hanya di
  environment server yang menjalankan `seal/prepare` dan `approve`.
- Ekspor zip tanpa `.env*`.

## 6. Belum dikerjakan di tahap 2

- **H5**: audit eksternal Patronage + Splitter v2 + Strongbox v2 + bug bounty. Wajib sebelum mainnet.
- Splitter v2 **tidak diubah**. Ia mengikat Strongbox lewat tipe v1 (`WageholdStrongbox`); Strongbox v2
  ABI-identik untuk `getJob`, `releasedToPayee`, `pendingWithdrawals`, `withdraw`, dan urutan `Status`
  serta `Job` sengaja disamakan. Versi yang lebih bersih adalah antarmuka `IWageholdStrongbox`; aman
  dilakukan begitu kompiler tersedia.
- Dukungan dua Strongbox sekaligus di app (bagian 3).
- Tahap 3 (migrasi SQL, indexer, API) dan tahap 4 (frontend).
- `scripts/e2e-testnet.ts` masih memakai ABI Splitter v1.

## 7. Perubahan pada file tahap 1

`src/WageholdPatronage.sol`: ditambah `guardian` (hanya `pause()` instan; `unpause` dan setter tetap
owner/timelock), `setGuardian`, event `GuardianUpdated`, error `NotOwnerOrGuardian`. `pause()` kini
boleh dipanggil owner atau guardian. Konstruktor tidak berubah, jadi tes tahap 1 tetap berlaku.
