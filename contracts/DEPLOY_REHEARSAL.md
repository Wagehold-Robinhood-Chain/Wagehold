# Deploy rehearsal — Fase 2 item 4

**Dijalankan:** 27 September 2026, `script/Deploy.s.sol` lewat `forge script ... --broadcast`
terhadap **Anvil lokal** (chain ID 31337) -- BUKAN Robinhood Chain testnet sungguhan. Sandbox
sesi ini tidak punya akses ke domain `*.robinhood.com` maupun `*.g.alchemy.com` (diblokir di
level proxy jaringan), jadi tidak mungkin broadcast ke RPC Robinhood Chain sungguhan dari sini.

## Kenapa rehearsal di Anvil lokal tetap berarti

Robinhood Chain sepenuhnya kompatibel EVM (Arbitrum Orbit) -- mekanisme deploy (urutan
constructor call, bagaimana `CREATE` menghitung alamat kontrak, bagaimana `vm.startBroadcast`
menandatangani transaksi) **identik** di EVM chain mana pun, termasuk Anvil lokal. Yang beda
antar chain cuma RPC endpoint, chain ID, dan kondisi jaringan sungguhan (gas price, waktu
konfirmasi) -- bukan logika deploy itu sendiri. Jadi rehearsal ini memverifikasi hal yang
memang bisa diverifikasi tanpa akses jaringan sungguhan: **apakah script-nya benar**, bukan
**apakah Robinhood Chain testnet-nya hidup** (itu baru bisa dicek pas benar-benar dijalankan
dari mesin dengan akses ke Alchemy).

## Yang diverifikasi

### 1. Deploy dasar (`DEPLOYER_PRIVATE_KEY` saja, sisanya default ke deployer)

```
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
→ ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.
  wageToken:          0x5FbDB...80aa3   (MockUSDC baru, karena WAGE_TOKEN_ADDRESS tidak diisi)
  WageholdStrongbox:  0xe7f17...b0512
  WageholdSplitter:   0x9fE46...fa6e0
```

### 2. Deploy dengan alamat custom (`COUNCIL_ADDRESS`/`LAMP_OIL_TREASURY_ADDRESS`/`TITHE_TREASURY_ADDRESS` diisi beda dari deployer) + pembacaan ulang lewat `cast call`

```
strongbox.council()        = 0x7099...c79C8   ✓ cocok dengan COUNCIL_ADDRESS
strongbox.owner()          = 0xf39F...9226    ✓ default ke deployer (OWNER_ADDRESS tidak diisi)
splitter.strongbox()       = 0xe7f1...b0512   ✓ persis alamat Strongbox yang baru dideploy
splitter.council()         = 0x7099...c79C8   ✓ cocok
splitter.lampOilTreasury() = 0x3C44...293BC   ✓ cocok
splitter.titheTreasury()   = 0x90F7...93B906  ✓ cocok
```

Membuktikan urutan deploy (`Strongbox` dulu, lalu `Splitter` dengan alamat Strongbox sebagai
constructor arg) benar dan tiap env var terbaca ke slot yang tepat -- bukan tertukar.

### 3. Smoke test alur penuh di atas kontrak yang baru dideploy (bukan cuma baca state kosong)

Job 1.000 mUSDC dari `createJob` sampai `withdraw`, semuanya lewat `cast send` sebagai wallet
berbeda-beda (client, council, "siapa saja" buat `pullAndSplit`, dan Patron pool sendiri buat
`withdraw`), persis alur yang didokumentasikan di `WageholdSplitter.sol`:

```
createJob(1000 mUSDC) → setPayee(splitter) → registerJob(patronPool)
  → approve() [seal] → pullAndSplit() → patron.withdraw()

Hasil akhir:
  patron mUSDC balance       = 700_000000   (700 mUSDC = 70%)
  splitter pending[lampOil]  = 200_000000   (200 mUSDC = 20%, belum ditarik lampOil)
  splitter pending[tithe]    = 100_000000   (100 mUSDC = 10%, belum ditarik tithe)
  strongbox token balance    = 0            (semua wage sudah keluar dari escrow)
```

700 + 200 + 100 = 1.000 tepat -- tidak ada dust yang hilang, konsisten dengan fuzz test di
`test/WageholdSplitter.t.sol`. Ini kali pertama alur itu diuji lewat transaksi on-chain
sungguhan (`cast send`, bukan `vm.prank` di dalam test Solidity), termasuk deploy sungguhan
(bukan `new WageholdStrongbox(...)` langsung di `setUp()` seperti di test suite).

## Yang MASIH belum diverifikasi (di luar cakupan rehearsal ini)

- **RPC Alchemy/Robinhood Chain sungguhan** -- rehearsal ini pakai Anvil lokal, bukan RPC
  Robinhood Chain testnet yang sesungguhnya. Kualitas endpoint (latency, rate limit),
  perilaku sequencer, dan kondisi jaringan sungguhan cuma bisa diuji dari mesin yang punya
  akses ke `https://robinhood-testnet.g.alchemy.com`.
- **Verifikasi kontrak di Blockscout** (`forge verify-contract --verifier blockscout`) --
  belum dicoba sama sekali, butuh kontrak yang benar-benar ada di explorer sungguhan.
- **Testnet ETH sungguhan** -- rehearsal ini pakai akun kaya bawaan Anvil. Deploy sungguhan
  butuh `DEPLOYER_PRIVATE_KEY` yang benar-benar terisi ETH dari faucet Robinhood Chain
  testnet (lihat `contracts/README.md` § Chain target).
- **`WAGE_TOKEN_ADDRESS` sungguhan** -- rehearsal ini biarkan script deploy `MockUSDC`-nya
  sendiri (karena env var itu memang sengaja dikosongkan). Belum ada USDC bridged resmi yang
  dikonfirmasi alamatnya di Robinhood Chain testnet per sesi ini -- kalau sudah ada, isi
  `WAGE_TOKEN_ADDRESS` di `.env` supaya deploy sungguhan tidak memakai `MockUSDC` (yang
  `mint()`-nya terbuka untuk siapa saja, lihat komentar `@dev` di `test/mocks/MockUSDC.sol`).

## Cara jalankan sendiri (di mesin dengan akses ke Robinhood Chain testnet)

```bash
cd contracts
cp .env.example .env
# isi ROBINHOOD_TESTNET_RPC_URL (API key Alchemy) dan DEPLOYER_PRIVATE_KEY (wallet testnet
# yang sudah diisi ETH dari faucet -- lihat contracts/README.md)

forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast \
  --verify --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api
```

Kalau mau rehearsal dulu di mesin sendiri sebelum ke testnet sungguhan (disarankan), jalankan
persis seperti di atas tapi ke Anvil lokal:

```bash
anvil &                                          # terminal terpisah
export DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # akun #0 bawaan Anvil, sudah terisi ETH palsu
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```
