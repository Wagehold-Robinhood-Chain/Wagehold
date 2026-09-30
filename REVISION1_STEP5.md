# Revision 1, langkah 5: WageholdSplitter 60/20/10/10 + burn

## Yang berubah di kontrak
- Split: Patrons 6000 / Lamp Oil 2000 / Tithe (sisa: 1000 + dust) / Furnace 1000 bps.
- `pullAndSplit` membukukan Furnace ke `pendingBurn` (tidak ada transfer keluar di langkah ini).
- `burn()` (permissionless): kirim `pendingBurn` ke `BURN_ADDRESS` (0x…dEaD), tambah `totalBurned`.
- Event `JobSplit` punya argumen ke-6 `burnAmount`; ada event `Burned`; error `NothingToBurn`.
- Dust pembulatan masuk Tithe (sebelumnya komentar bilang Patrons, kode sebenarnya Tithe).

## WAJIB
- Ini kontrak BARU: redeploy Strongbox + Splitter, isi ulang `WAGEHOLD_SPLITTER_ADDRESS` di env.
  Splitter lama tidak bisa di-upgrade (tanpa proxy).
- Kompilasi & test belum dijalankan (sandbox tanpa forge): `cd contracts && forge build && forge test -vv`.
- Panggil `burn()` berkala (keeper / setelah `pullAndSplit`), atau app memanggilnya di `splitAfterRelease`.

## Catatan
- Token di dead address tetap terhitung di `totalSupply()`. Kalau $WAGE punya `burn()` (ERC20Burnable),
  ganti transfer di `burn()` dengan `IERC20Burnable(wageToken).burn(amount)`.
- Temuan S5 (dispute parsial -> Splitter tidak solvent) BELUM diperbaiki dan sekarang ikut mempengaruhi
  `burn()` (bisa memakai token job lain). Perbaiki sebelum dispute dibuka; lihat E2E_TESTNET.md.
