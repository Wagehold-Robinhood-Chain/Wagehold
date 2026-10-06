# Daftar penerimaan §10 (Dev Brief) dengan bukti

Teks §10 diambil dari `Wagehold-Patronage-devbrief.md`. Kolom "Status" hanya memakai tiga nilai:
**Ada tes** = kode dan tes yang cocok ada di repo tetapi belum dijalankan di sandbox ini (tidak ada `forge`);
**Terbukti** = dijalankan dan lulus di sandbox; **Belum bisa dibuktikan** = butuh deploy, wallet, atau tindakan manusia.

| # | Kriteria §10 | Bukti di repo | Status |
|---|---|---|---|
| 1 | Job tersegel di bangunan bersaham menaikkan claimable staker tepat 60% × wage × bagian (±1 wei) | `WageholdSplitterV2.PATRON_BPS = 6000`; `testFuzz_SingleNotify_ProRataWithinOneWei`, `testFuzz_ManyNotifies_NeverOverpay`, `test_FullFlow_SealSplitPatronsClaim` | Ada tes |
| 2 | Job di bangunan tanpa staker memancarkan `RewardRedirected` dan saldo treasury naik | `notifyReward` (cabang `staked == 0`); `test_Notify_NoStakers_RedirectsToTreasury`, `test_Notify_NoStakers_TreasuryRefuses_BooksAndFlushes`, `test_FullFlow_NoStakers_RedirectsToTreasury` | Ada tes |
| 3 | Owner/multisig tidak bisa memindahkan $WAGE staked atau reward belum diklaim | `rescueToken` menolak token $WAGE (`CannotRescueWageToken`); `test_Owner_CannotTouchStakedOrRewardWage`, `test_TimelockCannotRescueWageToken` | Ada tes |
| 4 | `claim` dan `withdraw` jalan saat pause | `claim`, `claimMany`, `withdraw`, `requestUnstake` tanpa `whenNotPaused` (hanya `stake` yang dibatasi); `test_Pause_ClaimAndWithdrawWork`, `test_Paused_ClaimAndWithdrawStillWork` | Ada tes |
| 5 | Cooldown ditegakkan dan dana yang sedang cooldown tidak menghasilkan reward | `withdraw` menolak sebelum `unlockAt`; `requestUnstake` mengurangi `totalStaked`; `test_Withdraw_EnforcesCooldown`, `test_RequestUnstake_MovesToCooldownAndEarnsNothing` | Ada tes |
| 6 | `/patronage` dan panel profil jalan end to end dengan MetaMask di chain 4663 (approve + stake, request unstake, withdraw, claim) | Hook dan panel ada (4A/4B); tes logika murni lulus | **Belum bisa dibuktikan** (butuh browser, wallet, kontrak ter-deploy). Catatan: `activeChain` bernilai mainnet 4663 hanya bila `NEXT_PUBLIC_WAGEHOLD_NETWORK=mainnet`; kosong berarti testnet 46630 |
| 7 | Weighhouse menampilkan total staked on-chain; tidak ada label "(simulation)" untuk Patronage | `patronage_totals()` (0019) dan `getCountingHouse`; label dibersihkan di 4D; audit kata 0 temuan | Terbukti untuk kode dan SQL; tampilan browser belum dilihat |
| 8 | Owner dan Council adalah Safe, key Registrar hanya punya hak payee/registrasi job, timelock aktif | `WageholdTimelock` (lantai 24 jam); `test_Topology_OwnersAreTheTimelock`, `test_LeakedRegistrar_*`, `test_Timelock_*`; rencana peran di `contracts/PATRONAGE_ROLLOUT.md` | Ada tes untuk kode. **Belum bisa dibuktikan** untuk konfigurasi Safe dan signer di mainnet |
| 9 | Semua kontrak baru terverifikasi di Blockscout dan alamatnya tercantum di situs | `/patronage` mencantumkan Patronage, Splitter v2, Strongbox v2 dengan tautan Blockscout | Sebagian: Timelock belum tercantum, dan tidak ada footer situs; verifikasi Blockscout **belum bisa dibuktikan** |
| 10 | Tidak ada kata APR/APY/yield di mana pun | `lib/wording.ts` (kini juga "passive income" dan "guaranteed"); `scripts/audit-wording.ts` | Terbukti: 201 file, 0 temuan |

## Yang perlu dijalankan di mesin dengan Foundry

```
cd contracts
forge test            # termasuk fuzz dan invariant Patronage
slither .
```

Lalu uji manual di testnet 46630 sebelum mainnet: approve + stake, request unstake, withdraw, claim, dan satu job disegel
(bangunan bersaham dan tanpa saham).
