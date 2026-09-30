# Wagehold contracts

Fase 2 item 1 (`WageholdStrongbox`) + item 2 (`WageholdSplitter`), workspace **Foundry** terpisah dari app Next.js di root (`../app`, dst). Belum ada dependensi silang antara keduanya -- app masih pakai simulasi database untuk payout (lihat catatan di `wagehold-checklist.md` Fase 2), belum menyentuh kontrak ini sama sekali. Menyambungkannya adalah Fase 2 item 6-7.

## ✅ Sudah dikompilasi & di-test sungguhan (27 September 2026)

Sempat ada sesi di mana sandbox tidak punya akses `forge`/`solc`/internet sama sekali, jadi kontrak-kontrak ini sempat cuma direview manual baris-per-baris. Itu sudah tidak berlaku: `forge build` dan `forge test` sudah benar-benar dijalankan (binary Foundry v1.8.3 + solc 0.8.24, dependency `forge-std` v1.16.2 dan `openzeppelin-contracts` v5.7.0). Hasilnya **46/46 test lulus** (24 `WageholdStrongbox` + 22 `WageholdSplitter`, termasuk 2 fuzz test sampai 10.000 run), plus `slither .` sekali jalan dengan nol temuan yang menyentuh kontrak sendiri.

Yang **belum** diverifikasi: deploy sungguhan ke testnet manapun (item 4) -- `forge build`/`forge test` cuma bukti kontrak benar secara lokal, bukan bukti akan sukses di RPC node sungguhan.

## Setup

```bash
# 1. Install Foundry (sekali saja per mesin)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# 2. Dari folder contracts/ ini
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit

# 3. Compile
forge build

# 4. Test (verbose supaya kelihatan trace kalau ada yang gagal)
forge test -vvv

# 5. (opsional tapi direkomendasikan) fuzz lebih banyak run dari default
forge test -vvv --fuzz-runs 10000
```

Kalau `forge build` gagal karena versi OpenZeppelin yang ter-install tidak cocok dengan asumsi di bawah (§ "Kenapa `Ownable` tidak dipakai"), cek versi yang ter-install (`cat lib/openzeppelin-contracts/package.json | grep version`) dan sesuaikan pin di `.gitmodules`/`forge install ...@v5.x.x` kalau perlu.

## Chain target: Robinhood Chain (lewat Alchemy)

Kontraknya sendiri **tidak butuh perubahan apa pun** untuk pindah chain -- Robinhood Chain adalah Arbitrum Orbit chain yang sepenuhnya kompatibel EVM, Solidity dan tooling Foundry standar jalan tanpa modifikasi. Yang beda cuma target deploy (item 4, belum dikerjakan):

- **Testnet** -- chain ID 46630, RPC `https://robinhood-testnet.g.alchemy.com/v2/<API_KEY>`
- **Mainnet** -- chain ID 4663, RPC `https://robinhood-mainnet.g.alchemy.com/v2/<API_KEY>`
- Gas dibayar pakai ETH (tidak ada token gas terpisah), jadi tidak ada perubahan di parameter `wageToken` constructor -- itu tetap alamat ERC20 terpisah, apa pun tokennya.
- Alchemy dipakai karena itu penyedia RPC yang **direkomendasikan resmi** oleh `docs.robinhood.com/chain` -- endpoint publik (`rpc.testnet.chain.robinhood.com`) dibatasi rate-limit, tidak cocok untuk pemakaian produksi/CI.
- Copy `.env.example` di folder ini jadi `.env`, isi `ROBINHOOD_TESTNET_RPC_URL`/`ROBINHOOD_MAINNET_RPC_URL` dengan API key dari [dashboard.alchemy.com](https://dashboard.alchemy.com/signup) (pilih network "Robinhood Chain" saat bikin app). `foundry.toml` sudah baca dua env var ini lewat `[rpc_endpoints]`.
- Explorer-nya Blockscout (`explorer.testnet.chain.robinhood.com` / `robinhoodchain.blockscout.com`), bukan Etherscan -- verifikasi kontrak nanti (item 4) lebih aman lewat `forge verify-contract --verifier blockscout --verifier-url <url>/api` langsung, bukan cuma andalkan config `[etherscan]` di `foundry.toml`.

## Yang ada di item 1 & 2 ini

- **`src/WageholdStrongbox.sol`** -- kontrak escrow. Fungsi: `createJob`, `approve` ("Set the seal"), `refund`, `dispute` ("Break the seal"), plus `setPayee` dan `resolveDispute` (lihat di bawah kenapa dua ini ditambah di luar daftar fungsi persis di `wagehold-handoff.md` §6.2).
- **`test/WageholdStrongbox.t.sol`** -- 24 test (Forge/`forge-std`), termasuk 1 fuzz test, menutupi semua transisi status dan access control.
- **`src/WageholdSplitter.sol`** *(item 2, baru)* -- kontrak pembagi wage 60/20/10/10 (Patrons/Lamp Oil/Tithe/Furnace; Furnace dibukukan di `pendingBurn`, dibakar ke `0x…dEaD` lewat `burn()` permissionless). Fungsi: `registerJob` (snapshot amount + Patron pool per job, dipanggil `council`), `pullAndSplit` (permissionless -- menarik dari Strongbox lalu membagi tiga), `withdraw` (pull-payment), plus admin (`setCouncil`/`setOwner`/`setLampOilTreasury`/`setTitheTreasury`). Kenapa `registerJob` perlu ada sama sekali (bukan cuma baca `job.amount` langsung saat split) dijelaskan di komentar `@dev` atas file itu -- ringkasnya: `WageholdStrongbox.pendingWithdrawals` cuma per-address, bukan per-job, jadi Splitter perlu bukukan sendiri berapa milik job mana sebelum saldo gabungan itu ditarik.
- **`test/WageholdSplitter.t.sol`** *(item 2)* -- 22 test, termasuk 1 fuzz test yang memverifikasi split selalu menjumlah pas ke `amount` (tidak ada dust yang hilang) dan 1 test skenario dua job ditarik bersamaan (`pullAndSplit` dipanggil back-to-back sebelum saldo Strongbox kosong).
- **`test/mocks/MockUSDC.sol`** -- token ERC20 mint-bebas 6 desimal, dipakai `forge test` dan (kalau `WAGE_TOKEN_ADDRESS` dikosongkan) `script/Deploy.s.sol` untuk testnet -- **bukan token sungguhan**, jangan dipakai sebagai `wageToken` di mainnet.
- **`script/Deploy.s.sol`** *(item 4, baru)* -- deploy `WageholdStrongbox` lalu `WageholdSplitter` (urutan wajib, Splitter butuh alamat Strongbox). Semua alamat (`council`/`owner`/treasury/`wageToken`) dibaca dari env var lewat `vm.envOr`, jadi script yang sama jalan di Anvil lokal, Robinhood Chain testnet, atau mainnet tanpa diedit -- tinggal ganti `--rpc-url` dan isi `.env`. Sudah direhearsal penuh (deploy + smoke test job sampai split sungguhan) di Anvil lokal, lihat `DEPLOY_REHEARSAL.md`.

## Desain & keputusan yang menyimpang dari spesifikasi tertulis

`wagehold-handoff.md` §6.2 cuma menyebut `createJob`, `approve`, `refund`, `dispute`. Dua fungsi tambahan yang saya buat, dan alasannya:

- **`setPayee(jobId, payee)`** -- spek tidak bilang bagaimana kontrak tahu Wright mana yang mengerjakan job (assignment Warden masih di database, Fase 1, belum on-chain). Fungsi ini yang menjembatani: dipanggil `council` (placeholder admin key, **bukan** agent -- Charter II) begitu Warden meng-assign job di database. `approve()` butuh `payee` sudah ke-set sebelum bisa dipanggil.
- **`resolveDispute(jobId, payeeAmount, refundAmount)`** -- spek cuma bilang "Council decides" tanpa detail fungsi. Diimplementasikan sebagai pemisahan wage antara payee dan client, wajib jumlahnya pas (`SplitMismatch` kalau tidak), dipanggil `council`.

Kedua peran ini (`council`, `owner`) sengaja masih alamat EOA/Safe multisig biasa -- **bukan** kontrak `WageholdCouncil` sungguhan (itu Fase 3+, governance beneran, lihat `wagehold-lore.md` §5).

## Kenapa `Ownable` OpenZeppelin tidak dipakai

`Ownable` versi 4 (`constructor()`, owner = `msg.sender` otomatis) dan versi 5 (`constructor(address initialOwner)`, wajib eksplisit) beda tanda tangan constructor -- breaking change yang gampang bikin `forge build` gagal kalau saya menebak versi yang salah, dan saya tidak bisa mengecek versi mana yang akhirnya ter-install lewat `forge install` di mesin kamu. Karena peran admin di kontrak ini cuma dua fungsi kecil (`setCouncil`, `setOwner`), saya tulis manual (`address public owner` + modifier `onlyOwner`) supaya tidak bergantung ke API yang bisa berubah. `IERC20`, `SafeERC20`, dan `ReentrancyGuard` tetap dari OpenZeppelin karena API ketiganya sudah stabil bertahun-tahun lintas versi major.

## Pola pull-payment

`approve`, `refund`, dan `resolveDispute` semuanya cuma menambah saldo di `pendingWithdrawals[address]` -- tidak pernah mengirim token langsung. Penerima (client, payee, atau nanti `WageholdSplitter` yang berperan sebagai `payee`) menarik sendiri lewat `withdraw()`. Ini sesuai pola yang disebut eksplisit untuk `WageholdSplitter` di §6.2, dan dipakai juga di sini supaya `payee` yang berupa kontrak (Splitter) tidak bisa memblokir `approve()`/`resolveDispute()` selesai (mis. lewat `revert` di `receive()`) -- risiko klasik push-payment.

## Konvensi `jobId`

`jobId` (`bytes32`) diisi pemanggil, bukan counter internal, supaya `jobs.id` (UUID) di Postgres bisa dipetakan 1:1. Konvensi yang direncanakan buat Fase 2 item 6 (`POST /api/jobs` mengunci wage on-chain): `jobId = keccak256(bytes(uuidString))` -- satu baris di `ethers.js`/`viem` (`keccak256(toUtf8Bytes(uuid))` / `keccak256(toBytes(uuid))`). Kontrak sendiri tidak peduli konvensinya apa, asal pemanggil konsisten.

## `WageholdSplitter` (item 2) -- kenapa `registerJob` perlu ada

Cara paling naif buat "split 60/20/10/10" kelihatannya cuma: jadikan Splitter `payee` sebuah job, dan begitu `pullAndSplit` dipanggil, baca `strongbox.getJob(jobId).amount` lalu bagi tiga. Itu **tidak cukup** begitu Splitter yang sama dipakai lebih dari satu job (mis. dua Wright berbeda pakai Splitter yang sama karena `lampOilTreasury`/`titheTreasury`-nya sama): `WageholdStrongbox.pendingWithdrawals` itu **per-address**, bukan per-job -- kalau dua job sama-sama di-`approve()` sebelum salah satunya sempat ditarik, saldo pending Splitter di Strongbox sudah jadi satu angka gabungan, dan `job.amount` yang dibaca belakangan tetap benar per job (itu tidak berubah), tapi kontrak butuh tempat menyimpan "berapa dari saldo gabungan itu jatah job ini" -- makanya `registerJob` menyimpan snapshot `amount` (dan `patronPool`-nya) *sebelum* `approve()` dipanggil, bukan membaca ulang saat split.

Konsekuensinya: `registerJob` **wajib** dipanggil `council` setelah `strongbox.setPayee(jobId, address(splitter))` tapi sebelum client memanggil `strongbox.approve(jobId)` -- kalau lupa, `pullAndSplit` cuma revert `JobNotRegistered`, wage tetap aman di Strongbox (bisa `dispute`/nunggu `council` register belakangan, job tidak macet permanen).

`pullAndSplit` sendiri **permissionless** (siapa saja boleh memanggilnya) karena ia cuma memindahkan jatah job yang sudah terdaftar ke tiga alamat tetap yang sudah direkam -- tidak ada yang bisa dialihkan oleh pemanggil sembarang, jadi tidak perlu `onlyCouncil`. Ini juga berarti UI bisa memicu `pullAndSplit` otomatis begitu `approve()` selesai (Fase 2 item 7), tanpa perlu `council` online.

`patronPool` per job (bukan satu alamat Patron tetap untuk semua Wright) sengaja jadi parameter `registerJob`, bukan state kontrak -- karena distribusi Patron sungguhan (token per Wright) itu Fase 4, belum ada. Untuk sekarang `council` cukup masukkan alamat placeholder apa pun per Wright; begitu Fase 4 item 2-4 selesai, `patronPool` untuk job-job baru tinggal diarahkan ke kontrak distributor Patron sungguhan tanpa mengubah `WageholdSplitter` sama sekali.

## Cakupan item 1 & 2 vs item lain di Fase 2

| Di kontrak ini? | Kenapa |
|---|---|
| Escrow (lock/release/refund/dispute) | ✅ Item 1, `WageholdStrongbox` |
| Split 60/20/10/10 (Patrons/Lamp Oil/Tithe/Furnace) | ✅ Item 2, `WageholdSplitter` -- `payee` sebuah job di Strongbox sekarang *bisa* jadi alamat Splitter ini, tanpa perlu ubah `WageholdStrongbox` sama sekali |
| Distribusi ke Patron individual (token holder) | ❌ Fase 4 -- `patronPool` di Splitter masih alamat placeholder per Wright, bukan kontrak distributor sungguhan |
| Slither / static analysis | ✅ Item 3 -- `slither .` dijalankan, nol temuan di kedua kontrak sendiri (17 hasil semuanya milik dependency OpenZeppelin). Detail & cara reproduksi di `SLITHER_REPORT.md` |
| Deploy ke Robinhood Chain testnet | 🟡 Item 4 -- `script/Deploy.s.sol` sudah ada dan direhearsal penuh di Anvil lokal (deploy + smoke test job sampai split sungguhan (rehearsal lama masih 70/20/10, ulangi setelah redeploy), lihat `DEPLOY_REHEARSAL.md`), tapi **belum pernah broadcast ke RPC Robinhood Chain sungguhan** -- sandbox sesi ini tidak punya akses ke domain `*.robinhood.com`/`*.g.alchemy.com` |
| Wallet connect frontend | ❌ Item 5, di app Next.js |
| `POST /api/jobs` mengunci wage on-chain sungguhan | ❌ Item 6 -- app masih simulasi database (lihat `wagehold-checklist.md`) |

## Belum ada / batasan yang disadari

- `script/Deploy.s.sol` sudah ada dan direhearsal di Anvil lokal (item 4) -- tapi **belum pernah broadcast ke Robinhood Chain testnet sungguhan**, cuma dibuktikan mekanismenya benar lewat EVM lokal. Detail lengkap apa yang sudah/belum diverifikasi ada di `DEPLOY_REHEARSAL.md`.
- Slither sudah dijalankan (item 3, lihat `SLITHER_REPORT.md`) -- nol temuan di kode kita sendiri. Tapi ini **bukan pengganti audit manusia**: sebelum menangani dana sungguhan di mainnet (bukan lagi testnet), tetap disarankan audit eksternal terlepas dari hasil bersih ini, sesuai `wagehold-handoff.md` §9.
- `resolveDispute` (Strongbox) mempercayai `council` sepenuhnya untuk menentukan split yang adil -- belum ada mekanisme voting/timelock; itu memang pekerjaan `WageholdCouncil` sungguhan di Fase 3+.
- Tidak ada batas waktu (timeout) buat job yang macet di `Open` tanpa pernah di-`approve`/`refund`/`dispute` -- client yang lupa/tidak aktif bisa membuat wage "nyangkut" (masih bisa ditarik client sendiri kapan saja lewat `refund`, asal belum ada payee -- tapi kalau sudah ada payee dan client hilang, satu-satunya jalan keluar sekarang cuma `dispute` lewat client itu sendiri juga, yang berarti kalau client benar-benar hilang, dana beku permanen sampai ada mekanisme timeout/Council). Kandidat perbaikan sesi berikutnya kalau diminta.
- `WageholdSplitter` tidak punya cara untuk "un-register" job yang salah didaftarkan (`patronPool` salah, mis. typo alamat) sebelum `pullAndSplit` -- kalau ini terjadi, satu-satunya jalan sekarang adalah tidak pernah memanggil `pullAndSplit` untuk job itu (wage tetap aman menganggur di Strongbox, `council` cuma tidak bisa mendaftarkan ulang dengan `patronPool` yang benar karena `JobAlreadyRegistered`) -- kandidat perbaikan (mis. `council`-only `correctPatronPool` sebelum `split == true`) kalau dibutuhkan.
