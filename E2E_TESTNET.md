# E2E di testnet — Fase 2 item 8

Dua bagian, dengan status berbeda:

| Bagian | Apa | Status |
|---|---|---|
| **A. Skrip otomatis** `scripts/e2e-testnet.ts` | Seluruh siklus wage on-chain (kunci → payee → seal → split → withdraw, plus refund & dispute) dengan **kode server app yang sama** (`verify-lock`, `council`, `verify-release`) | ✅ Lulus di Anvil lokal (chain id 46630). **Belum pernah dijalankan ke RPC Robinhood sungguhan** — sandbox tidak punya akses ke domain itu |
| **B. Klik manual di browser** | Alur yang melewati wagmi/AppKit + Supabase + route HTTP | ⬜ Belum — butuh wallet + browser + Supabase |

## A. Skrip otomatis

### Cek cepat di lokal (tanpa akun apa pun)

```bash
npm install
# Foundry (anvil + forge) harus ada di PATH; contracts/lib harus terisi:
#   cd contracts && forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts && cd ..
npm run e2e:local            # Anvil + Deploy.s.sol + mode splitter + mode direct
bash scripts/e2e-local.sh --with-finding   # + skenario S5 (lihat "Temuan" di bawah)
```

### Di Robinhood Chain testnet

1. **Dua wallet testnet khusus** (bukan wallet berisi dana asli), keduanya diisi ETH dari faucet:
   *deployer/council* dan *client* (~0.002 ETH cukup untuk client; council sedikit lebih).
2. **Deploy** (Fase 2 item 4 — belum pernah di-broadcast; ini juga menutupnya):
   ```bash
   cd contracts && cp .env.example .env   # isi ROBINHOOD_TESTNET_RPC_URL (Alchemy) + DEPLOYER_PRIVATE_KEY
   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast \
     --verify --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api
   ```
   Catat tiga alamat yang tercetak (wageToken, Strongbox, Splitter). Dengan default,
   council = Lamp Oil = Tithe = deployer.
3. **Isi env**: `cp scripts/.env.e2e.example scripts/.env.e2e`. `COUNCIL_PRIVATE_KEY` = kunci deployer,
   `E2E_CLIENT_PRIVATE_KEY` = kunci wallet client (**harus beda** dari council).
4. **Jalankan**:
   ```bash
   npm run e2e            # Strongbox + Splitter 70/20/10, refund, dispute
   npm run e2e:direct     # tanpa Splitter: wage penuh ke wallet Wright
   ```
   Exit code 0 = semua lulus. Laporan per-langkah (hash tx, gas, waktu) ditulis ke
   `scripts/e2e-report-<mode>.json`; tempel angka gas/hash-nya ke checklist.

Yang dicek (ringkas): wage benar-benar pindah ke Strongbox; server membaca amount dari chain (bukan
dari klaim client); job yang belum dikunci/Refunded/Disputed ditolak `verifyOnChainLock`/`verifyReleased`;
`approve` sebelum payee → `PayeeNotSet`; hanya council yang boleh `setPayee`; hanya client yang boleh
menyegel/refund/dispute (Charter I); `preparePayeeOnChain` idempoten; split persis 70/20/10 tanpa dust
hilang dan Strongbox kosong untuk job itu; `pullAndSplit` ulang ditolak; `withdraw` menambah saldo token
sebesar pending; `resolveDispute` menolak jumlah tak pas.

### Kalau gagal

| Gejala | Penyebab umum |
|---|---|
| `chain id: RPC melapor X, app mengunci 46630` | RPC salah. Anvil lokal harus `--chain-id 46630` (library app mengunci chain itu) |
| `COUNCIL_PRIVATE_KEY = council() Strongbox …` | Kunci bukan alamat `COUNCIL_ADDRESS` saat deploy |
| `ETH gas … terlalu sedikit` | Isi dari faucet |
| Gagal di tengah dengan error rate-limit/timeout | Ganti ke URL Alchemy (endpoint publik dibatasi) |
| `token ini tidak bisa di-mint` | `WAGE_TOKEN_ADDRESS` bukan MockUSDC — kirim token ke wallet client |

## Temuan: `WageholdSplitter` + dispute parsial tidak solvent (skenario S5, opt-in)

Terbukti di Anvil lewat transaksi sungguhan (bukan asumsi). Job 100 dengan payee = Splitter →
client `dispute()` → council `resolveDispute(60 payee / 40 client)`:

- Strongbox hanya mengkredit Splitter **60**, dan `pullAndSplit` menarik 60.
- Tapi `pullAndSplit` membagi `amount` snapshot dari `registerJob` (**100**, dan status `Released` lolos
  pengecekannya) → ledger Splitter dikredit **100** (Patron 70 / Lamp Oil 20 / Tithe 10).
- Akibat (terbukti di run): kekurangan 40. Patron menarik jatahnya (70) **revert** karena saldo token
  Splitter cuma 60.
- Dari membaca kode, **belum dijalankan**: di Splitter yang menampung banyak job, saldo token dipakai
  bersama, jadi kekurangan itu ditanggung job lain (penarikan terakhir yang gagal). Kasus refund penuh
  (`payeeAmount = 0`) semestinya lebih buruk: Splitter tidak menerima apa pun tapi tetap mengkredit 100.

Belum ada jalur UI/route dispute di app, jadi belum ada paparan lewat aplikasi — hanya lewat panggilan
langsung `council`. Tapi ini harus beres sebelum dispute dibuka. Opsi perbaikan (butuh ubah kontrak +
redeploy, sengaja belum saya sentuh):

1. Strongbox mencatat jumlah yang benar-benar dirilis ke payee per job (mis. `releasedToPayee`), dan
   `pullAndSplit` membagi `min(sj.amount, releasedToPayee)`.
2. Atau `pullAndSplit` menolak job yang statusnya `Released` lewat `resolveDispute` (tandai di Strongbox).
3. Pengaman operasional sementara: jangan pernah `resolveDispute` parsial pada job yang payee-nya Splitter.

**Jangan jalankan `--with-finding` di Splitter testnet bersama** — skenarionya sengaja membuat defisit
permanen di Splitter itu. Hanya untuk Anvil lokal / deploy sekali-pakai.

## B. Klik manual di browser (belum dikerjakan)

Sisa yang tidak bisa diverifikasi tanpa browser + wallet + Supabase; lakukan sekali setelah A lulus:

1. Supabase: jalankan migrasi 0001–0004; aktifkan Email OTP + Redirect URL `/auth/callback`.
2. `.env.local`: Supabase, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (Reown), `NEXT_PUBLIC_STRONGBOX_ADDRESS`,
   `NEXT_PUBLIC_WAGE_TOKEN_ADDRESS`, `COUNCIL_PRIVATE_KEY`, `WAGEHOLD_SPLITTER_ADDRESS`,
   `WAGEHOLD_PATRON_POOL_ADDRESS` (seed belum mengisi `agents.wallet`), `GEMINI_API_KEY`.
3. `npm run dev`, login (magic link), **Connect wallet**, pindah ke Robinhood Chain testnet.
4. Post a Job → dua tanda tangan (approve token + `createJob`); cek panel Escrow ada link tx, dan
   `budget_usdc` di DB = nominal on-chain.
5. Tunggu Deepdive mengerjakan (`review`), klik **Set the seal** → dua langkah (prepare di server, `approve`
   di wallet); job jadi `paid`, Ledger menampilkan link tx, event `split_pending` **tidak** muncul.
6. Cek explorer: `SealSet` di Strongbox, `JobSplit` di Splitter (70/20/10).
7. **Send back** dan `simulasi` (tanpa env escrow) tetap jalan seperti sebelumnya.
8. Catat kebingungan UX (mis. dua popup wallet berturut-turut, tidak ada indikator menunggu konfirmasi).

Yang secara khusus **hanya** teruji lewat langkah ini: `sealOnChain`/`lockWageOnChain` lewat wagmi,
route `/seal/prepare` dan `/approve` dengan Supabase sungguhan, dan temuan RLS di `approveJob` simulasi
(lihat catatan item 7 di checklist).
