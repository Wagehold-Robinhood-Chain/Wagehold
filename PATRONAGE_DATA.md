# Patronage on-chain: data & backend (Tahap 3)

Dev Brief §7. Menambah lapisan data di atas kontrak Tahap 1/2. Tidak mengubah alur seal, Strongbox, atau tabel simulasi.

## Urutan menjalankan
1. `supabase db push` -> migrasi `0018_patronage_onchain.sql`.
2. `npx tsx --env-file=.env.local scripts/patronage-backfill-agent-ids.ts --dry-run`, lalu tanpa `--dry-run`.
   Mengisi `agents.chain_agent_id` (= `keccak256(bytes(agents.id))`). Tanpa ini bangunan tidak muncul di API.
3. Setelah batch Timelock selesai dan kontrak aktif, isi env server:
   `WEIGHHOUSE_PATRONAGE_ADDRESS`, `WEIGHHOUSE_STRONGBOX_V2_ADDRESS`, `WEIGHHOUSE_SPLITTER_V2_ADDRESS`,
   `WEIGHHOUSE_PATRONAGE_DEPLOY_BLOCK` (blok PEMBUATAN kontrak paling awal; event sebelumnya tidak akan diindeks).
   Kosong = aliran Patronage mati, Weighhouse lama tidak terpengaruh.
4. Cron `index-chain` yang sudah ada otomatis menjalankan aliran baru. Hasilnya ada di `patronage` pada respons cron.
5. Monitor: `npx tsx --env-file=.env.local scripts/patronage-reconcile.ts` (exit 1 kalau indexer != kontrak).

## Apa yang ditambah
- `chain_events` tetap sumber event mentah. Aliran baru: `v2:<strongboxV2>:<splitterV2>` dan `patronage:<alamat>`, masing-masing dengan cursor sendiri.
- `patronage_apply()` (SQL) menurunkan `patron_positions` dan `building_pools`. Atomik, idempoten, gagal keras bila ada event yang tidak masuk akal.
- Fungsi baca (service role, semua jumlah `text`): `patronage_pools`, `patronage_positions_of`, `patronage_pool_rewards`, `patronage_totals`.
- API: `GET /api/patronage/pools?sort=staked|wages7d`, `GET /api/patronage/pools/:agentId` (uuid atau bytes32), `GET /api/patronage/me?wallet=`.
  Semua read-only. Respons memuat `indexedBlock`. Pending rewards TIDAK di API: UI membaca `pendingRewards()` lewat viem.

## Keputusan yang menyimpang dari brief
- `building_pools.registered` ditambah (daftar pool hanya bangunan terdaftar atau yang masih punya stake).
- `paidToPatrons7d` memakai reward yang benar-benar dibagi ke patron (`RewardNotified`), bukan `JobSplit.patronAmount`. Field `cutPer1000Staked` dibuang (Sesi 4D); per-1.000 dihitung di `rewardPer1000`.
- `patronCut7d` hanya mencakup Splitter v2 (v1 tidak menyimpan agentId).

## SENGAJA belum dikerjakan
- Membekukan `stakes` / `stake_payouts` (§7.2). `record_wage_split` masih menulis payout simulasi di tiap seal dan mengisi
  `wage_splits.treasury_redirect` (dasar Counting House). Membekukan tabel tanpa menulis ulang fungsi itu akan merusak pencatatan seal.
  Dikerjakan bersama Tahap 4 (UI + Counting House).
- Weighhouse (`staked` di `weighhouse_top_buildings`, "Staked by patrons", Ledger Wall) masih membaca sumber lama.
  `patronage_totals()` dan `PATRONAGE_LEDGER_EVENT_NAMES` sudah siap untuk Tahap 4.
