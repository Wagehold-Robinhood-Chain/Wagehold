# Checklist Wagehold — Seluruh Brief

> Diperbarui: 29 September 2026 — Fase 3 item 3, 4, 5 dikerjakan dan diverifikasi (`tsc`, `eslint`, `next build` lulus, 16 route): rank Wright sekarang dari `deriveRank()` (sealed jobs + rating sungguhan, bukan seed), `lib/agents/research-wright.ts` diganti `lib/agents/wright-runtime.ts` yang menghidupkan kelima Ward (migrasi baru `0008_all_wards_live.sql` mengisi 14 Wright non-Warden sisanya), dan `selectWright()` membagi job baru ke Wright paling idle di Ward-nya (bukan lagi satu Wright tetap per Ward). Lihat catatan lengkap di bawah. **Fase 1 kelar (11/11), Fase 3: 3/5 (item 3, 4, 5 -- sisa item 1-2 butuh kontrak `WageholdRegistry` on-chain), Fase 2: 4/8 + item 4/6/7/8 sebagian.**
>
> Sebelumnya, 28 September 2026 — Fase 2 item 8 dikerjakan (🟡, lihat catatan item 8): harness E2E on-chain lulus di Anvil lokal (82 + 52 pengecekan), **belum dijalankan ke testnet sungguhan**, dan menemukan bug nyata di Splitter + dispute. Sebelumnya, Fase 2 item 7 dikerjakan (🟡, lihat catatan item 7): sisi server + kontrak diuji sungguhan di Anvil lokal, klik wallet di browser belum. Sebelumnya, Fase 2 item 6 dikerjakan (🟡, lihat catatan item 6). Sebelumnya, 27 September 2026 — Fase 2 item 5 selesai: tombol **Connect wallet** (Reown AppKit/WalletConnect + wagmi) di header semua halaman, target Robinhood Chain. **Terverifikasi sungguhan:** `npm install` + `next build` (compile, TypeScript, 15 route) lulus, dan SSR `/jobs/new` dicek dengan/tanpa `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Belum diuji: klik connect dengan wallet sungguhan (butuh browser + wallet). Item 4 tetap 🟡 (belum broadcast ke testnet sungguhan). **Fase 1 kelar (11/11), Fase 2: 4/8 selesai + item 4, 6, 7, 8 sebagian.**

## Fase 0: Prototipe Visual
| # | Item | Status |
|---|---|---|
| 1 | `wagehold-prototype.html` (Three.js, data demo) | ✅ Selesai (dari sebelum sesi ini) |

---

## Fase 1: One Live Ward (MVP — sedang dikerjakan)
| # | Item | Status |
|---|---|---|
| 1 | Setup Next.js 16 + Tailwind v4 + Motion + Supabase | ✅ Selesai |
| 2 | Komponen dasar (23 komponen: Panel, Button, JobCard, JobBoard, JobDetail, AgentProfile, LoginForm, AuthStatus, dst) | ✅ Selesai |
| 3 | Route Handler `/api/agents`, `/api/jobs` + seed 20 Wright | ✅ Selesai |
| 4 | Page A — City Dashboard (scene Three.js) | ✅ Selesai |
| 5 | Page B — Job Board | ✅ Selesai |
| 6 | Page C — Post a Job | ✅ Selesai |
| 7 | Page D — Job Detail / Seal Gate | ✅ Selesai |
| 8 | Page E — Wright Profile | ✅ Selesai |
| 9 | ~~Halaman login/auth client~~ **Digantikan:** login dihapus total. Identitas = wallet (mode on-chain) atau id browser lokal (mode simulasi); header punya **Connect wallet** sebagai gantinya. Lihat README → *Identitas (tanpa login)* dan migrasi `0009_wallet_identity.sql` | ✅ Diganti *(login dihapus, `POST /api/jobs` dan gerbang seal kini memakai cookie browser / tanda tangan wallet)* |
| 10 | Hubungkan 1 agent Research Ward ke AI beneran (job beneran diproses, bukan simulasi) | ✅ Selesai *(pakai Gemini, bukan Claude API -- lihat catatan)* |
| 11 | Realtime Ledger Wall (SSE/WebSocket, pengganti polling) | ✅ Selesai *(pakai Supabase Realtime/WebSocket, bukan SSE custom -- lihat catatan)* |

**Catatan verifikasi sesi ini (item 9):** File `wagehold-nextjs-setup__2_.zip` yang di-upload ternyata sudah berisi implementasi login lengkap -- checklist sebelumnya belum sempat diperbarui untuk mencerminkan ini. Yang dicek:
- `npm install` + `npx tsc --noEmit` bersih untuk semua file terkait auth (`app/login/page.tsx`, `components/login-form.tsx`, `components/auth-status.tsx`, `app/auth/callback/route.ts`, `proxy.ts`) -- nol error, tidak ada regresi di file lain.
- **Alur:** `LoginForm` (email-only, tanpa password) memanggil `supabase.auth.signInWithOtp()` dari browser client → email berisi magic link → `app/auth/callback/route.ts` menukar `code` jadi sesi sungguhan lewat `exchangeCodeForSession()` (PKCE) → redirect balik. Link kadaluarsa/sudah dipakai → balik ke `/login?error=auth_failed` dengan pesan di atas form.
- **`proxy.ts`** (nama baru `middleware.ts` di Next.js 16) me-refresh sesi di tiap request. Catatan CVE-2025-29927 sudah benar: proxy TIDAK dijadikan satu-satunya lapis auth -- tiap Route Handler (`approve`, `revise`, `POST /api/jobs`) tetap memanggil `supabase.auth.getUser()` sendiri, sudah dicek di `app/api/jobs/[id]/approve/route.ts` dan `revise/route.ts`.
- **`components/auth-status.tsx`** terpasang di header kelima page (A-E) -- dicek lewat grep, semua lima file punya `<AuthStatus />`. Dengar `onAuthStateChange()` + `router.refresh()`, jadi status login dan semua Server Component di halaman yang sama (mis. `isOwnJob`) ikut update tanpa reload manual.
- Pesan "login belum ada" di Page B/C/D sudah diganti jadi link langsung ke `/login` (dicek di `job-board.tsx`, `post-job-client.tsx`, `job-detail.tsx`).
- `README.md` sudah punya bagian **Login (magic link)** lengkap dengan langkah setup di Supabase dashboard (aktifkan Email OTP, tambahkan `/auth/callback` ke Redirect URLs).
- **Konsekuensi:** gerbang seal di Page B & D dan submit di Page C sekarang **bisa** dites sungguhan dari browser asal `.env.local` sudah diisi dan magic link di-setup di Supabase dashboard -- bukan lagi selalu 401.

**Catatan item 10 (Research Ward hidup):**
- **Ganti Claude API → Gemini.** Brief aslinya minta Claude API, tapi diminta pakai AI gratisan di sesi ini, jadi dipakai Google Gemini (tier gratis Google AI Studio) lewat `lib/agents/gemini.ts` (REST langsung, tanpa SDK tambahan). Ganti balik ke Claude API nanti tinggal file baru senada + tukar satu import di `research-wright.ts`, tidak menyentuh Route Handler.
- **Satu Wright, bukan seluruh Ward.** Sesuai poin brief ("1 agent"), yang hidup baru **Deepdive ($DIVE)**, bukan Lumen Research (Warden). Semua job `district: "research"` untuk sekarang jatuh ke Deepdive -- routing multi-Wright oleh Warden tetap Fase 3 item 5, belum disentuh.
- **Alur:** `POST /api/jobs` dan `POST /api/jobs/:id/revise` sekarang memanggil `runResearchJob()` (`lib/agents/research-wright.ts`) sebelum request selesai. Kalau `district === "research"`: assign Deepdive → status `working` (+event Ledger) → panggil Gemini dengan `agents.system_prompt` sebagai system instruction → berhasil → simpan ke kolom baru `jobs.deliverable`, status `review` (+event `submitted`). Job Ward lain tidak tersentuh sama sekali (tetap seperti sebelumnya).
- **Send back ikut memproses ulang.** Kalau client klik *Send back*, Deepdive dipanggil lagi dengan catatan revisi client disisipkan ke prompt (diambil dari event `sent_back` terakhir) -- bukan cuma balik ke status `working` tanpa kerja seperti sebelumnya.
- **Kolom yang sebelumnya nganggur, sekarang dipakai.** `agents.system_prompt` dan `agents.model` ada di schema sejak awal tapi tidak pernah dibaca kode manapun (dicek lewat grep sebelum menulis kode) -- migrasi baru `0003_research_wright_live.sql` mengisi keduanya untuk Deepdive (`model = 'gemini-3.8-flash'`, `system_prompt` berisi peran + batasan Charter: tidak boleh janji return/rekomendasi beli-jual, tidak boleh mengarang sumber/angka).
- **Kegagalan ditangani, bukan dibiarkan macet.** Kalau `GEMINI_API_KEY` kosong atau panggilan Gemini gagal/timeout, job dikembalikan ke status `open` (bukan macet di `working`) dan event `error` tercatat di Ledger menjelaskan sebabnya -- wage tetap aman di Strongbox (Charter I). Belum ada tombol "coba lagi" di UI untuk kasus gagal-di-percobaan-pertama; jalan keluarnya sekarang posting ulang atau tunggu sampai *Send back* dipakai setelah percobaan pertama berhasil.
- **UI baru:** panel **Deliverable** di Page D (Job Detail) -- baru muncul kalau `jobs.deliverable` terisi -- supaya client benar-benar bisa membaca hasil kerja Deepdive sebelum Set the seal, bukan cuma progress bar kosong seperti sebelumnya.
- **Perlu dijalankan manual:** migrasi `0003_research_wright_live.sql` (setelah 0001 & 0002) dan isi `GEMINI_API_KEY` di `.env.local` (ambil gratis di aistudio.google.com/apikey) -- keduanya didokumentasikan di README bagian **Research Ward (live agent)**.
- **Perbaikan sampingan (bukan bagian item 10, ditemukan saat verifikasi):** `types/database.ts` (placeholder manual) belum punya field `Relationships`/`Views`/`Functions`/`Enums` yang sekarang diwajibkan versi `@supabase/postgrest-js` yang ter-install (`^2.106.1` di package.json ternyata resolve ke 2.117.2) -- akibatnya SEMUA query Supabase di seluruh proyek (bukan cuma kode baru) diam-diam bertipe `never`, lolos dari `tsc` versi lama tapi gagal di versi sekarang. Dikonfirmasi dengan menjalankan `tsc --noEmit` di file upload asli sebelum diubah apa-apa (errornya sama). Sudah diperbaiki dengan menambah field-field kosong itu ke placeholder-nya. `npx tsc --noEmit` sekarang bersih kecuali 4 error pre-existing di `components/city-scene.tsx` (tipe material Three.js, tidak terkait item 10 -- dikonfirmasi sama di file upload asli juga, belum diperbaiki karena di luar cakupan sesi ini).

**Catatan item 11 (Realtime Ledger Wall):**
- **Pakai Supabase Realtime, bukan SSE/WebSocket custom.** Brief arsitektur (`wagehold-handoff.md` §6) menyebut "SSE / WebSocket", tapi karena stack sudah Supabase, dipakai **Supabase Realtime** (Postgres logical replication yang di-broadcast lewat WebSocket bawaan `supabase-js`) -- efeknya sama (push, bukan polling), tanpa perlu bikin server broadcaster sendiri yang tidak akan reliable di deployment serverless (mis. Vercel) karena tidak ada memori/koneksi yang persisten lintas request/instance.
- **Migrasi baru `0004_realtime_ledger.sql`** -- menyalakan publication `supabase_realtime` untuk tabel `jobs`, `job_events`, `agents`. **Perlu dijalankan manual** (setelah 0001-0003) sebelum fitur ini kepakai; tanpa ini, subscription di browser diam saja tanpa error jelas (didokumentasikan di README bagian **Realtime Ledger Wall**, termasuk alternatif toggle manual di Dashboard → Database → Replication).
- **Ketiga page yang kepakai:** City Dashboard (`app/page.tsx`), Job Board (`app/jobs/page.tsx`), Job Detail (`app/jobs/[id]/page.tsx`) sekarang cuma Server Component tipis yang ambil data awal, lalu diteruskan ke Client Component baru (`realtime-city-dashboard.tsx`, `realtime-job-board.tsx`, `realtime-job-detail.tsx`) yang subscribe lewat hook baru `lib/supabase/realtime.ts` (`useRealtimeChanges`).
- **Job Detail pakai filter per-job** (`id=eq.<jobId>`, `job_id=eq.<jobId>`) supaya cuma dengar job itu sendiri, bukan seluruh kota -- ini yang langsung menjawab keluhan checklist sebelumnya: client yang sedang membuka halaman job Research Ward-nya sekarang melihat Deepdive bergerak `open → working → review` dan panel Deliverable muncul tanpa refresh, walau prosesnya berjalan di request `POST /api/jobs` yang berbeda (request itu sendiri `await runResearchJob()` sebelum selesai, jadi bisa makan beberapa detik).
- **Gerbang seal ikut dibenahi.** `isOwnJob` sebelumnya dihitung sekali di server dari `auth.getUser()`; sekarang komponen realtime melacak user id sendiri lewat hook baru `use-current-user-id.ts` (`onAuthStateChange`), supaya gerbang seal tetap benar begitu user sign in/out -- tidak bergantung ke `router.refresh()` dari `AuthStatus`, yang tidak menyentuh state client yang sudah diinisialisasi dari props awal (`useState(initial...)` cuma dibaca sekali saat mount).
- **RLS tidak diubah.** Ketiga tabel sudah publicly readable (`using (true)`) sejak `0001_init.sql`, jadi broadcast Realtime ke anon key di browser tidak membocorkan apa pun yang belum bisa dibaca lewat query biasa.
- **Belum ada verifikasi compiler di sesi ini.** Environment sandbox sesi ini **tidak punya akses ke npm registry sama sekali** (`x-deny-reason: host_not_allowed`, beda dari sesi-sesi sebelumnya yang sempat menjalankan `npm install` + `npx tsc --noEmit`) -- jadi seluruh kode Realtime ini baru direview manual baris-per-baris (tipe generic hook dicocokkan ke `types/database.ts`, prop-passing dicek satu-satu), **belum dijalankan lewat `tsc` sungguhan**. Tolong jalankan `npm install && npx tsc --noEmit` di environment yang ada akses internet (lokal / Claude Code) sebelum dianggap benar-benar "nol error" -- kalau ada error dari sini, kemungkinan besar di salah satu dari 6 file baru: `lib/supabase/realtime.ts`, `lib/supabase/use-current-user-id.ts`, `components/realtime-city-dashboard.tsx`, `components/realtime-job-board.tsx`, `components/realtime-job-detail.tsx`, atau 3 page.tsx yang ditulis ulang.
- **Keterbatasan bawaan platform** (bukan bug, sudah didokumentasikan di README): (1) race condition kecil di Supabase Realtime -- event yang ditulis ~1-3 detik pertama setelah channel baru `SUBSCRIBED` kadang tidak terkirim ([supabase-js#1599](https://github.com/supabase/supabase-js/issues/1599)); (2) belum ada indikator status koneksi (live/reconnecting) di UI.
- **Yang sengaja belum disentuh:** animasi koin terbang ke Counting House (`coins()` di prototipe) -- Ledger Wall dan status sudah live, tapi animasi koin spesifik itu belum diporting; masuk kandidat sesi berikutnya kalau diminta.

**Catatan Page B:**
- 4 tab: *Awaiting seal / In progress / Open / Sealed*, sesuai `wagehold-handoff.md` §3.
- Gerbang seal (**Set the seal** / **Send back**) sudah jalan lewat `POST /api/jobs/:id/approve` dan `/revise`, dengan catatan revisi wajib diisi dulu sebelum *Send back* dikonfirmasi (Article IV).
- `isOwnJob` dihitung di server dari `auth.getUser()` -- sekarang sungguhan bisa dites setelah login (lihat catatan item 9 di atas).
- Nav kecil (*The City* / *Job Board*) ditambahkan ke Page A & B supaya saling terhubung.

**Catatan Page C:**
- Form (`PostJobForm`, sudah ada sebelumnya) dibungkus `PostJobClient` yang memanggil `POST /api/jobs`. Berhasil → redirect ke `/jobs` (job baru langsung terlihat di tab *Open*).
- Error `"Sign in to post a job"` (401) sekarang berisi link langsung ke `/login`.
- Caption panel mengikuti *clarity rule* lore file §8: *"The Gate — where clients enter to post jobs..."* menyandingkan istilah lore dengan arti polosnya.

**Catatan Page D:**
- `app/jobs/[id]/page.tsx` -- job + timeline (`job_events`) lewat `getJobById`, plus profil Wright (nama, rank) lewat `getAgentById` terpisah kalau `agent_id` ada.
- Menggunakan ulang `JobCard` (dari Page B) untuk ringkasan + gerbang seal, ditambah section **Brief** lengkap, **Wright** (link ke `/agents/[id]`, sekarang hidup -- lihat Page E), dan **Ledger** khusus job itu.
- Judul job di `JobCard` sekarang jadi link ke halaman ini (dari Job Board dan City Dashboard).
- `notFound()` dipanggil kalau ID job tidak ada.

**Catatan Page E:**
- `app/agents/[id]/page.tsx` -- profil Wright lewat `getAgentById`, plus semua job milik agent itu lewat `listJobsByAgent` untuk menurunkan status kerja saat ini (idle/working/review) dan daftar **Sealed jobs**-nya (status `paid`), ditampilkan pakai `JobCard` yang dipakai ulang lagi (read-only, tanpa gerbang seal).
- `components/agent-profile.tsx` -- ticker, Ward, chip rank, status pill, deskripsi, stat grid (revenue 30d, Patrons, rating, sealed jobs), dan **Wage split** pakai `RevenueSplit` dengan angka tetap 70/20/10 dari Charter (lore file §6) -- bukan kolom di tabel `agents`, karena splitnya memang sama untuk semua Wright.
- Tombol **Hire $TICKER** mengarah ke `/jobs/new?district=<ward-agent-ini>` -- belum meng-assign job langsung ke Wright itu (routing per Ward masih Fase 3 item 5), cuma pre-fill Ward di form.
- **Tidak ada** token price / 14-hari sparkline seperti di panel profil prototipe -- skema `agents` belum punya snapshot harian. Ditandai sebagai kandidat Fase 4.
- Building di City Dashboard (`city-scene.tsx`) sudah `router.push('/agents/${id}')` -- klik gedung sekarang menuju halaman ini, tidak 404 lagi.

---

## Fase 2: Strongbox on Testnet
| # | Item | Status |
|---|---|---|
| 1 | Contract `WageholdStrongbox` (escrow) + test | ✅ Selesai **dan terverifikasi** *(dikompilasi + 24 test dijalankan sungguhan sesi ini -- lihat catatan verifikasi di bawah)* |
| 2 | Contract `WageholdSplitter` (70/20/10) + test | ✅ Selesai **dan terverifikasi** *(dikompilasi + 22 test dijalankan sungguhan -- lihat catatan di bawah)* |
| 3 | Jalankan Slither, perbaiki temuan | ✅ Selesai -- nol temuan di kontrak sendiri, laporan lengkap di `contracts/SLITHER_REPORT.md` |
| 4 | Deploy ke Robinhood Chain testnet | 🟡 `script/Deploy.s.sol` sudah dibuat & direhearsal penuh di Anvil lokal (deploy + smoke test job sampai split 70/20/10 sungguhan) -- **belum pernah broadcast ke RPC Robinhood Chain sungguhan**, lihat `contracts/DEPLOY_REHEARSAL.md` |
| 5 | Wallet connect (WalletConnect) di frontend | ✅ Selesai -- build & SSR terverifikasi; klik connect dengan wallet sungguhan belum diuji, lihat catatan |
| 6 | Post a Job → lock wage on-chain sungguhan | 🟡 Kode selesai, `tsc --noEmit` bersih -- **belum pernah dijalankan terhadap kontrak sungguhan** (butuh item 4 di-broadcast), lihat catatan |
| 7 | Set the seal → release escrow on-chain sungguhan | 🟡 Kode selesai; `tsc`, `eslint`, `next build` bersih; alur server + kontrak diuji sungguhan di Anvil (mode Splitter & direct) -- **belum diuji dengan wallet browser sungguhan / RPC Robinhood sungguhan**, lihat catatan |
| 8 | Test end-to-end di testnet | 🟡 Skrip E2E `scripts/e2e-testnet.ts` selesai & lulus di Anvil lokal (mode Splitter + direct, refund, dispute) -- **belum dijalankan ke RPC Robinhood sungguhan** (butuh item 4 di-broadcast) dan **klik browser + wallet belum**; menemukan bug Splitter + dispute parsial, lihat catatan |

**Catatan Fase 2 item 8 (Test end-to-end di testnet):**
- **Yang dibuat:** `scripts/e2e-testnet.ts` (harness), `scripts/e2e-local.sh` (Anvil + `Deploy.s.sol` + kedua mode), `scripts/.env.e2e.example`, `E2E_TESTNET.md` (runbook), script npm `e2e` / `e2e:direct` / `e2e:local`, dependency dev `tsx`. Bagian server memakai **kode app yang sama** (`verifyOnChainLock`, `preparePayeeOnChain`, `verifyReleased`, `splitAfterRelease`), bukan reimplementasi. Bagian wallet client (approve token, `createJob`, `approve`) meniru `lock-wage.ts` / `set-the-seal.ts` dengan viem + private key, karena dua file itu memanggil wagmi/AppKit.
- **✅ Diverifikasi sungguhan (sesi ini, Anvil `--chain-id 46630`, kontrak dideploy lewat `Deploy.s.sol`):** mode splitter **82 lulus / 0 gagal**, mode direct **52 lulus / 0 gagal**; dengan `--with-finding` splitter jadi 88 lulus + 2 temuan. `tsc --noEmit` nol error; `eslint` bersih di file baru. Diulang dengan konfigurasi default testnet (council = Lamp Oil = Tithe = deployer, satu alamat) -- lulus juga. Kontrol negatif: `COUNCIL_PRIVATE_KEY` yang salah membuat harness gagal dengan pesan jelas (exit 1).
- **Skenario:** S1 siklus penuh + Splitter (lock → `verifyOnChainLock` baca amount dari chain → `verifyReleased` menolak job Open → `PayeeNotSet` → `NotCouncil` untuk client/pihak luar → `preparePayeeOnChain` + idempoten → `NotClient` untuk council/pihak luar → seal → `already_released` → `pullAndSplit` 70/20/10 persis, Strongbox kosong untuk job itu → split kedua dilewati → `JobAlreadySplit` → `withdraw` → `NothingToWithdraw`); S2 tanpa Splitter (wage penuh ke Wright); S3 refund (+ `JobAlreadyExists`, `ZeroAmount`, `verifyOnChainLock` menolak Refunded); S4 dispute + `resolveDispute` 60/40 (+ `SplitMismatch`, `verifyReleased` menolak Disputed).
- **🔴 Temuan (S5, opt-in `--with-finding`): `WageholdSplitter` tidak solvent pada dispute parsial.** `pullAndSplit` membagi `amount` snapshot dari `registerJob` (100), padahal `resolveDispute(60 payee / 40 client)` hanya mengkredit Splitter 60 di Strongbox. Terbukti lewat tx: ledger Splitter +100 vs token masuk 60; **`withdraw` Patron (70) revert** karena saldo Splitter cuma 60. Belum ada UI/route dispute, jadi belum terpapar lewat aplikasi, tapi wajib diperbaiki (ubah kontrak + redeploy) **sebelum** dispute dibuka. Opsi perbaikan di `E2E_TESTNET.md`. Kontrak sengaja belum saya ubah.
- **BELUM diverifikasi:** (1) RPC Robinhood testnet sungguhan (gas limit, latency, quirk chain) -- jalankan langkah di `E2E_TESTNET.md` §A dari mesin dengan akses jaringan; ini sekaligus menutup item 4; (2) klik wallet browser (`lockWageOnChain`/`sealOnChain` lewat wagmi) dan route HTTP `/seal/prepare` + `/approve` dengan Supabase sungguhan -- daftar klik manual di `E2E_TESTNET.md` §B; (3) temuan RLS di `approveJob` simulasi (catatan item 7) masih belum dibuktikan.
- **Catatan pemakaian:** jangan jalankan `--with-finding` di Splitter testnet bersama -- skenarionya sengaja membuat defisit permanen di Splitter itu. Satu run mengirim ~35 tx per mode, pakai RPC Alchemy (bukan endpoint publik yang rate-limited).

**Catatan Fase 2 item 7 (Set the seal → release escrow on-chain):**
- **Masalah desain yang harus dipecahkan:** `WageholdStrongbox.approve` hanya boleh dipanggil client (Charter I), tapi revert `PayeeNotSet` sampai *council* memanggil `setPayee` (dan `registerJob` di Splitter). Jadi seal butuh dua pihak: server (council key) menyiapkan payee, wallet client menyegel. Payee dihitung dari database (Wright yang di-assign), bukan dari request.
- **Alur** (`lib/web3/set-the-seal.ts`, dipakai Job Board & Job Detail): `POST /api/jobs/:id/seal/prepare` → wallet `approve(jobId)` → `POST /api/jobs/:id/approve` dengan `sealTx`. Server **membaca ulang chain** (`verify-release.ts`) dan hanya menandai `paid` kalau status `Released`; job dengan `escrow_tx` tidak bisa `paid` tanpa seal di chain. Setelah itu `pullAndSplit` (permissionless) membagi 70/20/10; kalau gagal, seal tetap sah dan event `split_pending` tercatat.
- **File baru:** `lib/web3/council.ts`, `verify-release.ts`, `splitter.ts`, `public-client.ts`, `set-the-seal.ts`, `app/api/jobs/[id]/seal/prepare/route.ts`. **Diubah:** `strongbox.ts` (ABI + `approve`/`setPayee`/`council`/custom errors), `verify-lock.ts` (pakai `public-client`), `app/api/jobs/[id]/approve/route.ts`, `queries.ts` (`approveJob` opsi on-chain), `job-card.tsx`, `job-detail.tsx`, `job-board.tsx`, `realtime-job-board.tsx`, `realtime-job-detail.tsx`, `app/jobs/page.tsx`, `app/jobs/[id]/page.tsx`, `.env.local.example`, `README.md`. Job Board sebelumnya tidak meneruskan `escrowTx` ke `JobSummary` -- sekarang diteruskan (tanpa itu Set the seal di Job Board akan jatuh ke alur simulasi). Ledger sekarang menampilkan link explorer untuk event ber-tx.
- **Env baru:** `COUNCIL_PRIVATE_KEY` (server-only; harus alamat yang sama dengan `council()`), `WAGEHOLD_SPLITTER_ADDRESS`, opsional `WAGEHOLD_PATRON_POOL_ADDRESS` (kalau `agents.wallet` kosong -- seed saat ini belum mengisi kolom itu).
- **✅ Diverifikasi sungguhan (sesi ini):** `npm install` + `npx tsc --noEmit` nol error, `eslint` bersih di semua file yang diubah, `next build` lulus (16 route, termasuk `/api/jobs/[id]/seal/prepare`; `next/font` di-stub sementara karena Google Fonts tidak terjangkau sandbox, layout asli dikembalikan). **Integrasi di Anvil lokal** (chain id 46630, kontrak asli dideploy lewat `Deploy.s.sol`), fungsi server dijalankan langsung: lock wage → `verifyReleased` menolak job `Open` → `approve()` sebelum payee = `PayeeNotSet` → council key salah ditolak sebelum tx apa pun dikirim → `preparePayeeOnChain` memasang payee (+`registerJob`) dan idempotent → non-client tidak bisa menyegel (`NotClient`) → `approve()` client → `verifyReleased` lulus → `already_released` di retry → `pullAndSplit` menghasilkan **700 / 200 / 100** dari 1.000 USDC, panggilan kedua dilewati. Diulang di mode direct (tanpa Splitter): wage penuh masuk ke wallet Wright, split dilewati.
- **BELUM diverifikasi:** (1) klik **Set the seal** dengan wallet browser sungguhan (`sealOnChain` lewat wagmi/AppKit -- logikanya sama dengan yang diuji di Anvil tapi jalurnya lewat wagmi, tidak ikut teruji); (2) route `/seal/prepare` dan `/approve` dengan Supabase sungguhan (tes Anvil memanggil fungsi library-nya, bukan HTTP); (3) RPC Robinhood testnet sungguhan (item 4 belum di-broadcast).
- **Keterbatasan diketahui:** (1) `COUNCIL_PRIVATE_KEY` adalah hot key di server -- cocok untuk testnet, untuk mainnet pindahkan ke Safe/signer terpisah atau `WageholdCouncil` (Fase 3+); (2) verifikasi hanya membaca **testnet**; (3) tidak ada tombol `withdraw` di UI -- Patron pool / Lamp Oil / Tithe menarik dana sendiri lewat `WageholdSplitter.withdraw()`, dan Wright di mode direct lewat `WageholdStrongbox.withdraw()`; (4) `sealTx` tidak dicek terhadap receipt, hanya status `Released` di chain; (5) alur dispute ("Break the seal"), refund, dan `resolveDispute` belum punya UI/route -- sisi kontrak kini teruji lewat E2E item 8 (S3/S4), UI/route tetap belum.
- **Temuan sampingan (belum diperbaiki, di luar item 7):** di `approveJob` versi simulasi, penulisan `job_events` dan update `agents` memakai client user biasa, padahal `0001_init.sql` hanya punya policy *select* untuk `job_events`/`agents` (catatan di akhir file itu sendiri bilang penulisannya sebaiknya service role). Kemungkinan besar kedua penulisan itu diam-diam ditolak RLS di alur simulasi -- **belum saya buktikan terhadap Supabase sungguhan**, tolong dicek (lihat apakah event "sealed" muncul di Ledger setelah Set the seal simulasi). Jalur on-chain baru sudah memakai service role untuk keduanya. Hal yang sama berlaku untuk `reviseJob`.

**Catatan Fase 2 item 6 (Post a Job → lock wage on-chain):**
- **Alur:** `post-job-client.tsx` membuat UUID di browser → `lib/web3/lock-wage.ts` (`approve` USDC kalau allowance kurang, lalu `WageholdStrongbox.createJob(keccak256(uuid), amount)`, tunggu receipt) → baru `POST /api/jobs` dengan `id` + `escrowTx`. Konvensi jobId mengikuti doc comment di `WageholdStrongbox.sol`.
- **Server tidak percaya klaim client:** `lib/web3/verify-lock.ts` membaca `getJob()` dari chain (harus status `Open`, amount > 0) dan **memakai amount dari chain sebagai `budget_usdc`**, bukan `budgetUsdc` dari body -- client tidak bisa mengklaim wage lebih besar dari yang terkunci. jobId dihitung ulang di server dari `id`.
- **Degradasi halus:** tanpa `NEXT_PUBLIC_STRONGBOX_ADDRESS` + `NEXT_PUBLIC_WAGE_TOKEN_ADDRESS`, Post a Job memakai alur simulasi lama persis seperti sebelumnya. Setup check punya baris baru "On-chain escrow env".
- **Retry aman:** kalau tx lock berhasil tapi simpan ke Supabase gagal, `pendingLock` menyimpan id+tx; submit ulang dengan nominal sama tidak mengunci dua kali.
- **UI:** panel **Escrow** di Job Detail berisi link tx ke explorer (cuma muncul kalau `escrow_tx` terisi). `SUPPORTED_CHAIN_IDS` dipindah ke `lib/web3/chains.ts`.
- **File baru:** `lib/web3/strongbox.ts`, `lock-wage.ts`, `verify-lock.ts`. **Diubah:** `chains.ts`, `wallet-connect.tsx`, `queries.ts`, `app/api/jobs/route.ts`, `post-job-client.tsx`, `post-job-form.tsx`, `status-check.tsx`, `job-detail.tsx`, `realtime-job-detail.tsx`, `app/jobs/[id]/page.tsx`, `types/domain.ts`, `.env.local.example`.
- **Diverifikasi:** `npm install` + `npx tsc --noEmit` nol error.
- **BELUM diverifikasi:** eksekusi nyata (approve/createJob dengan wallet sungguhan, `verifyOnChainLock` ke RPC sungguhan, insert Supabase dengan `id` eksplisit) -- butuh kontrak ter-deploy (item 4), wallet, dan Project ID Reown.
- **Keterbatasan diketahui:** (1) verifikasi server hanya membaca **testnet**; (2) kalau user mengubah nominal setelah lock-nya sudah jadi tapi gagal disimpan, lock lama menjadi yatim di chain (masih bisa `refund()` manual, belum ada UI); (3) verifikasi tidak mencocokkan `client` on-chain dengan user Supabase (belum ada tabel wallet-user); (4) `escrowTx` tidak dicek terhadap receipt, hanya state `getJob`.

**Catatan Fase 2 item 1 (`WageholdStrongbox`):**
- **Workspace baru:** `contracts/` -- Foundry, terpisah dari app Next.js (belum ada sambungan apa pun antara keduanya; itu baru item 6-7). Isinya: `src/WageholdStrongbox.sol`, `test/WageholdStrongbox.t.sol` (24 test + 1 fuzz test), `test/mocks/MockUSDC.sol`, `foundry.toml`, `remappings.txt`.
- **Fungsi:** `createJob` (lock wage), `approve` (Set the seal -- cuma client), `refund` (batal sebelum ada payee), `dispute` (Break the seal -- cuma client, sesuai state machine persis di `wagehold-handoff.md` §5), plus dua fungsi **di luar** daftar persis di spek: `setPayee` (menjembatani assignment Warden yang masih di database, dipanggil `council`, bukan agent -- Charter II) dan `resolveDispute` (spek cuma bilang "Council decides" tanpa detail fungsi).
- **Pull-payment**, bukan push: `approve`/`refund`/`resolveDispute` cuma menambah saldo di `pendingWithdrawals[address]`, penerima menarik sendiri lewat `withdraw()` -- sesuai pola yang disebut eksplisit untuk `WageholdSplitter` di spek, dipakai juga di sini supaya `payee` yang nanti berupa kontrak Splitter (item 2) tidak bisa memblokir pencairan.
- **`payee` = alamat yang nanti diisi `WageholdSplitter`** begitu item 2 selesai -- `WageholdStrongbox` sendiri sengaja tidak tahu apa-apa soal split 70/20/10, tidak perlu diubah sama sekali saat item 2 dikerjakan.
- **`Ownable` OpenZeppelin sengaja tidak dipakai** -- constructor-nya beda tanda tangan antara v4 dan v5 (breaking change), dan tidak bisa dipastikan versi mana yang ter-install lewat `forge install` nanti. Peran admin (`owner`, cuma buat `setCouncil`/`setOwner`) ditulis manual sebagai gantinya. `IERC20`, `SafeERC20`, `ReentrancyGuard` tetap dari OpenZeppelin (API-nya stabil lintas versi).
- **Konvensi `jobId`:** `bytes32` diisi pemanggil (bukan counter), direncanakan `keccak256(bytes(uuidString))` dari `jobs.id` di Postgres -- disiapkan buat item 6, belum disambung.
- **`council` dan `owner` masih placeholder EOA/multisig biasa**, bukan kontrak `WageholdCouncil` sungguhan (itu governance Fase 3+).

**✅ Verifikasi compiler -- akhirnya bisa dijalankan sesi ini (27 September 2026):** sesi-sesi sebelumnya sandbox-nya tidak punya akses ke `forge`/`solc`/internet sama sekali, jadi kontrak-kontrak ini cuma pernah direview manual baris-per-baris. Sesi ini ternyata *punya* akses ke `github.com`, `release-assets.githubusercontent.com`, dan `pypi.org` -- jadi binary Foundry (`forge` v1.8.3) dan `solc` v0.8.24 diunduh langsung dari GitHub releases (bukan lewat installer resmi `foundry.paradigm.xyz`/`binaries.soliditylang.org` yang masih diblokir), dan dependency (`forge-std` v1.16.2, `openzeppelin-contracts` v5.7.0) di-install lewat `forge install` biasa. Hasilnya:

```bash
$ forge build
Compiling 37 files with Solc 0.8.24
Compiler run successful!

$ forge test
Ran 2 test suites in 77.35ms: 46 tests passed, 0 failed, 0 skipped (46 total tests)
  - WageholdStrongbox.t.sol: 24 passed (termasuk 1 fuzz test)
  - WageholdSplitter.t.sol:  22 passed (termasuk 1 fuzz test)

$ forge test --fuzz-runs 10000   # kedua fuzz test, run lebih berat
  46 tests passed, 0 failed

$ slither . --filter-paths "lib/"   # item 3, ditutup resmi -- laporan lengkap di contracts/SLITHER_REPORT.md
  0 result(s) found -- nol temuan begitu dependency (forge-std, OpenZeppelin) dikeluarkan
  dari laporan. Tanpa filter, 17 hasil muncul tapi seluruhnya di file dependency OpenZeppelin
  (assembly usage, versi pragma library) -- tidak satu pun menyentuh WageholdStrongbox atau
  WageholdSplitter sendiri.
```

Satu warning linter sempat muncul (`event emitted after an external call` di `WageholdSplitter.pullAndSplit`) -- sudah diperbaiki dengan menata ulang urutan (semua effect + event dulu, baru panggilan ke Strongbox); build ulang setelah itu bersih untuk kedua kontrak kecuali 1 warning gaya (`nonReentrant is not the first modifier`) di `WageholdStrongbox` yang sudah ada dari item 1 dan di luar cakupan sesi ini.

**Yang masih belum diverifikasi:** broadcast sungguhan ke RPC Robinhood Chain testnet (item 4) -- `script/Deploy.s.sol` sudah direhearsal penuh di Anvil lokal (deploy dua kontrak + smoke test job dari `createJob` sampai `withdraw`, split persis 700/200/100 dari wage 1.000 mUSDC, lihat `contracts/DEPLOY_REHEARSAL.md`), tapi sandbox sesi ini tidak punya akses jaringan ke domain `*.robinhood.com`/`*.g.alchemy.com`, jadi belum ada bukti perilaku di RPC node sungguhan (gas limit, chain quirks, dst). Jalankan langkah "Cara jalankan sendiri" di `DEPLOY_REHEARSAL.md` dari mesin dengan akses itu untuk benar-benar menutup item 4.

*Catatan: payout di `approveJob` (Route Handler) sekarang masih simulasi database — bukan on-chain. Ini pengganti sementara sampai fase ini selesai.*

**Catatan Fase 2 item 5 (Wallet connect):**
- **Stack:** Reown AppKit (`@reown/appkit` + `@reown/appkit-adapter-wagmi` 1.8.24) di atas wagmi 3.7.7 / viem 2.56.9 / `@tanstack/react-query`. Pola mengikuti docs resmi Reown untuk Next.js App Router (cookie storage + `cookieToInitialState` di `app/layout.tsx` supaya tidak ada kedip "disconnected" saat SSR).
- **File baru:** `lib/web3/chains.ts` (Robinhood Chain testnet 46630 / mainnet 4663 sebagai custom chain), `lib/web3/config.ts`, `lib/web3/empty-module.js`, `components/web3-provider.tsx`, `components/wallet-connect.tsx`. **Diubah:** `app/layout.tsx`, 5 header (`realtime-city-dashboard`, `realtime-job-board`, `realtime-job-detail`, `jobs/new/page`, `agents/[id]/page` -- tombol di sebelah `AuthStatus`), `components/status-check.tsx` (cek "Wallet connect env"), `next.config.mjs`, `package.json` (+ `package-lock.json`), `.env.local.example`, `README.md`.
- **Degradasi halus:** tanpa `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, app tetap jalan dan tombolnya nonaktif (awalnya saya tulis melempar error saat import seperti contoh docs Reown -- itu akan menjatuhkan seluruh app termasuk halaman Setup check, jadi diganti). Terbukti: SSR `/jobs/new` = HTTP 200 di kedua kondisi, varian tombol yang benar di masing-masing.
- **Dua masalah kompatibilitas Next 16 yang ditemukan lewat build sungguhan:** (1) docs Reown menyuruh `webpack.externals.push(...)`, tapi Turbopack (default Next 16) menolak build kalau ada config `webpack` tanpa `turbopack` -> diganti `serverExternalPackages`. (2) konektor Coinbase di wagmi menarik `@coinbase/cdp-sdk` yang meng-import paket opsional `@x402/*` (tidak ter-install, tidak dipakai) -> "Module not found" saat build -> di-alias ke modul kosong lewat `turbopack.resolveAlias`.
- **Bug lama yang ikut ketahuan karena build/lint akhirnya bisa jalan:** `components/city-scene.tsx` gagal typecheck (`beacon.material.color/emissive` -- tipe `THREE.Mesh` terlalu longgar) -> sudah diperbaiki (tipe dipersempit ke `MeshLambertMaterial`). `eslint.config.mjs` rusak ("Converting circular structure to JSON", `FlatCompat` tidak cocok dengan eslint-config-next 16) -> sudah diperbaiki.
- **Belum diperbaiki (di luar scope, aturan lint React baru yang lebih ketat mengenai kode lama):** `setState` sinkron di effect (`status-check.tsx`, blok Supabase asli), akses ref saat render (`lib/supabase/realtime.ts`, `city-scene.tsx`), plus 2 warning `eslint-disable` tak terpakai. Semuanya kode yang sudah jalan; dibiarkan supaya tidak mengubah perilaku realtime tanpa diminta. Total `eslint .`: 3 error + 2 warning, **nol** di file item 5.
- **Belum diverifikasi:** klik Connect dengan wallet sungguhan / QR WalletConnect / pindah jaringan (butuh browser + wallet + Project ID Reown asli -- build ini pakai Project ID publik contoh dari docs Reown, yang hanya berlaku di localhost). Font Google tidak bisa diunduh di sandbox, jadi build verifikasi dijalankan dengan `next/font` di-stub sementara (layout asli sudah dikembalikan, tidak ada perubahan font).
- **Sengaja hanya koneksi:** belum baca saldo / kirim transaksi -- itu item 6-7.

**Catatan Fase 2 item 2 (`WageholdSplitter`):**
- **File baru:** `src/WageholdSplitter.sol`, `test/WageholdSplitter.t.sol` (22 test + 1 fuzz test). Tidak ada perubahan sama sekali di `WageholdStrongbox.sol` -- sesuai catatan di item 1, `payee` sebuah job cukup diarahkan ke alamat Splitter ini lewat `setPayee` yang sudah ada.
- **Kenapa perlu `registerJob` sebelum split:** `WageholdStrongbox.pendingWithdrawals` itu per-address, bukan per-job -- kalau Splitter yang sama dipakai lebih dari satu job dan beberapa `approve()` terjadi sebelum sempat ditarik, saldo pending Splitter di Strongbox jadi satu angka gabungan. `registerJob(jobId, patronPool)` (dipanggil `council`, setelah `setPayee` tapi sebelum `approve`) menyimpan snapshot jumlah wage job itu *sebelum* saldo bercampur, supaya `pullAndSplit` selalu tahu persis jatah tiap job walau saldo Strongbox-nya gabungan.
- **`pullAndSplit` permissionless** -- siapa saja boleh memanggilnya, karena ia cuma memindahkan jatah job yang sudah terdaftar ke tiga alamat tetap yang sudah direkam (Patron pool per job, `lampOilTreasury`/`titheTreasury` yang sama untuk semua Wright). Tidak ada yang bisa dialihkan pemanggil sembarang.
- **Dust pembulatan** (dari pembagian bilangan bulat 70/20/10) selalu masuk ke jatah Patrons, bukan hilang atau nyangkut di kontrak -- dibuktikan lewat fuzz test (`testFuzz_PullAndSplit_SplitAlwaysSumsToAmount`, 10.000 run) bahwa `patronAmount + lampOilAmount + titheAmount` selalu pas sama dengan `amount` asli, untuk jumlah berapa pun.
- **`patronPool` per-Wright** masih alamat placeholder yang dimasukkan manual per job oleh `council` -- distribusi ke Patron token holder sungguhan itu Fase 4 (belum dibangun). Begitu Fase 4 selesai, tinggal arahkan `patronPool` job-job baru ke kontrak distributor sungguhan, `WageholdSplitter` tidak perlu diubah.
- **Sama seperti Strongbox**, `Ownable` OpenZeppelin sengaja tidak dipakai (alasan sama: breaking change constructor v4 vs v5); admin (`owner`) ditulis manual.
- Detail lengkap (termasuk tabel cakupan item 1 vs 2 vs item Fase 2 lain, dan batasan yang diketahui seperti belum ada cara "batalkan pendaftaran" kalau `patronPool` salah didaftarkan) ada di `contracts/README.md`.

---

## Fase 3: All Wards + Registry
| # | Item | Status |
|---|---|---|
| 1 | Contract `WageholdRegistry` | ⬜ Belum |
| 2 | Daftarkan 20 Wright on-chain (baru ada di Supabase, belum on-chain) | ⬜ Belum |
| 3 | Logika rank dari rating nyata (sekarang masih angka seed statis) | ✅ Selesai -- lihat catatan |
| 4 | Agent runtime untuk 4 Ward sisanya (Chain, Craft, Watch, Hearth) | ✅ Selesai -- lihat catatan |
| 5 | Logika routing job per Ward (Warden membagi kerja) | ✅ Selesai -- lihat catatan |

**Catatan Fase 3 item 3 (Rank dari rating nyata):**
- Sesi sebelumnya sudah menurunkan `revenue30d`, `rating`, dan `jobsSealed` dari `jobs` sungguhan (`lib/agent-stats.ts` `deriveAgentStats()`, `0007_job_rating.sql`) -- tapi chip **rank** (Apprentice/Journeyman/Master) di ketiga halaman (Wright Profile, City Dashboard, Job Detail) masih dibaca langsung dari kolom `agents.rank` (angka demo seed). Itu bagian yang belum dikerjakan sesi ini.
- **`deriveRank(jobsSealed, rating)`** baru di `lib/agent-stats.ts`: master (≥20 job disegel **dan** rating ≥4.5), journeyman (≥5 job, rating tidak disyaratkan supaya Wright baru tidak tertahan cuma karena belum ada yang memberi rating), sisanya apprentice. Warden **tidak pernah** lewat fungsi ini -- perannya struktural (`agents.is_lead`), bukan tingkatan yang dicapai lewat volume kerja.
- Diterapkan di ketiga tempat yang menampilkan rank: `app/agents/[id]/page.tsx`, `components/realtime-city-dashboard.tsx` (state client, ikut Realtime), dan `app/jobs/[id]/page.tsx` (Wright chip di Job Detail -- ini butuh query tambahan `listJobsByAgent` per job supaya rank yang tampil konsisten dengan Wright Profile-nya).
- **Konsekuensi yang disengaja, didokumentasikan di komentar kode:** begitu ini aktif, deployment yang belum punya job `paid` sungguhan (seperti Supabase kamu sekarang) akan menampilkan **semua Wright non-Warden sebagai Apprentice**, walau kolom `agents.rank` seed-nya bilang Journeyman/Master. Ini konsisten dengan alasan item 3 dibuat -- rank yang tampil harus rank yang dibuktikan lewat kerja sungguhan, bukan angka demo. Kolom `agents.rank` sendiri tidak dihapus (tetap dipakai untuk Warden), cuma tidak lagi jadi sumber tampilan untuk Wright biasa.
- Thresholds di atas **tidak ada di brief manapun** -- keputusan implementasi sesi ini, didokumentasikan di komentar `deriveRank()` supaya bisa didebat/diubah kalau kamu mau angka lain.

**Catatan Fase 3 item 4 (Agent runtime 4 Ward sisanya):**
- `lib/agents/research-wright.ts` (Fase 1 item 10, khusus Deepdive/`district === "research"`) **dihapus**, digantikan `lib/agents/wright-runtime.ts` yang generik untuk kelima Ward -- fungsi utamanya sekarang `runWardJob(jobId)`, bukan `runResearchJob(jobId)`.
- **Migrasi baru `0008_all_wards_live.sql`** (jalankan setelah 0001-0007) mengisi `agents.system_prompt` + `agents.model` (`gemini-3.8-flash`, sama seperti Deepdive) untuk 14 Wright non-Warden yang tersisa: Chain (FLOW, DUNE, GAS), Craft (KILN, TIDE, LOOM), Watch (HOUND, KEYS, LENS), Hearth (WEAVE, PULSE, QUEST), plus 2 sisa Research (OWL, SCOUT) yang belum diisi 0003. Warden (WHALE, FORGE, SNTL, HRBR, dan LUMEN yang sudah diisi lebih dulu di 0002 sebagai Warden Research) sengaja **tidak** diisi -- perannya me-routing, bukan mengerjakan brief.
- Tiap prompt ditulis mengikuti gaya dan batasan Charter yang sama seperti Deepdive (0003): tidak janji return/rekomendasi beli-jual, tidak mengarang sumber/angka/kutipan, tutup dengan bagian \"Open questions\", nada tenang bukan hype -- disesuaikan per keahlian Wright (mis. Slither Hound/$HOUND fokus pola risiko kontrak, Dune Smith/$DUNE fokus desain dashboard, dst).
- `app/api/jobs/route.ts` dan `app/api/jobs/[id]/revise/route.ts` diubah: sebelumnya cuma memanggil runtime kalau `district === \"research\"`, sekarang memanggil `runWardJob()` tanpa syarat district -- job Ward mana pun sekarang langsung dikerjakan, bukan diam di `open` selamanya seperti sebelumnya.
- Auto-retry Gemini (503/429, sampai 4 percobaan + model cadangan opsional lewat `GEMINI_FALLBACK_MODEL`) yang sudah ada di `lib/agents/gemini.ts` dari sesi sebelumnya otomatis ikut berlaku untuk kelima Ward -- tidak perlu diubah, cuma dipanggil lebih sering sekarang.
- **Belum dikerjakan (di luar cakupan item 4):** tombol \"Try again\" di UI untuk job yang gagal di percobaan pertama -- jalan keluarnya tetap Send back (kalau job itu sudah pernah berhasil sekali) atau posting ulang job baru.

**Catatan Fase 3 item 5 (Routing per Ward oleh Warden):**
- **`selectWright(supabase, district)`** baru di `wright-runtime.ts` -- dipanggil `runWardJob()` setiap kali job baru (belum punya `agent_id`) butuh di-assign. Sebelumnya satu Ward = satu Wright tetap (mis. Research Ward selalu jatuh ke Deepdive, walau ada OWL dan SCOUT yang menganggur); sekarang Warden benar-benar \"membagi kerja\".
- Kriteria (didokumentasikan di komentar fungsi karena tidak ada spek persis di brief): (1) Wright non-Warden dengan job `working` aktif paling sedikit menang -- paling idle duluan; (2) seri → rank tertinggi (`deriveRank`, item 3) menang; (3) seri lagi → ticker alfabetis, supaya hasilnya stabil dan bisa diprediksi.
- Query dibatasi ke agents+jobs **dalam satu Ward saja** (biasanya 3-4 Wright non-Warden), bukan seluruh kota -- cukup murah untuk dijalankan tiap job baru tanpa index tambahan.
- **Send back tidak memicu routing ulang** -- job yang sudah punya `agent_id` selalu dikerjakan ulang oleh Wright yang sama, `selectWright()` cuma dipanggil untuk job yang benar-benar baru.
- **Keterbatasan diketahui (belum diperbaiki):** `selectWright()` membaca jumlah job aktif dengan satu query lalu meng-assign lewat query terpisah -- kalau dua job baru di Ward yang sama dibuat dalam request yang benar-benar tumpang tindih (race), keduanya bisa membaca \"0 job aktif\" yang sama dan terpilih Wright yang sama. Ini bukan bug keamanan (wage tetap aman di Strongbox), cuma beban kerja Ward jadi sedikit tidak merata di kondisi race yang jarang -- belum diperbaiki dengan locking/transaction.

**✅ Diverifikasi sungguhan sesi ini:** `npm install` + `npx tsc --noEmit` nol error, `eslint` bersih di semua file yang diubah/ditambah, `next build` lulus (16 route, sama seperti sebelumnya -- tidak ada route baru di item ini). Font Google di-stub sementara untuk verifikasi build (sandbox tidak ada akses `fonts.googleapis.com`), layout asli sudah dikembalikan persis seperti sebelumnya (dicek dengan `diff`). Logika `deriveRank`/`deriveAgentStats` diuji langsung lewat `tsx` di luar Next.js (lihat nilai uji di respons sesi ini) -- bukan lewat Supabase sungguhan, karena sandbox ini tidak punya akses ke project Supabase kamu.

**BELUM diverifikasi:** (1) `runWardJob`/`selectWright` terhadap Supabase sungguhan -- jalankan migrasi `0008` lalu coba Post a Job di keempat Ward yang baru hidup (Chain/Craft/Watch/Hearth) dan pastikan job bergerak `open → working → review`, bukan diam seperti sebelumnya; (2) kalau ada lebih dari satu Wright idle di satu Ward, coba Post beberapa job berurutan dan lihat apakah assignment-nya bergantian (bukan selalu Wright yang sama); (3) chip rank di Wright Profile/City Dashboard/Job Detail -- pastikan tampil \"Apprentice\" untuk semua Wright non-Warden sampai ada job `paid` sungguhan (perilaku yang disengaja, lihat catatan item 3), bukan error.

---

## Fase 4: Agent Tokens (Patrons)
| # | Item | Status |
|---|---|---|
| 1 | **Legal sign-off** revenue-share (gerbang wajib, bukan tugas build) | ⬜ Belum |
| 2 | Contract `WageholdAgentToken` (fixed supply + vesting) | ⬜ Belum |
| 3 | Audit kontrak eksternal | ⬜ Belum |
| 4 | Mekanisme distribusi ke Patron | ⬜ Belum |
| 5 | Hubungkan Wright Profile ke data Patron/token nyata | ⬜ Belum |

---

## Track paralel: Legal & Brand
| # | Item | Status |
|---|---|---|
| 1 | Cek domain/handle/trademark/`$WAGE` ticker | ⬜ Belum |
| 2 | Konsultasi hukum soal status token di bawah OJK | ⬜ Belum |
| 3 | Brief logo (wax-seal / keep silhouette) ke desainer | ⬜ Belum |

---

## Di luar roadmap Wagehold (Konsep 1 — Launch Foundry)
| # | Item | Status |
|---|---|---|
| 1 | Launch Foundry sebagai Foundry Ward keenam | ⬜ Belum — **eksplisit "out of scope for now"** di handoff §1 |
| 2 | 7 stasiun Launch Foundry (Ideation Lab → Orbit Control) | ⬜ Belum dimulai sama sekali |
| 3 | Guardrail anti-rug (lock likuiditas, no hidden mint, dst) | ⬜ Belum |

---

## Pertanyaan terbuka dari brief yang belum dijawab
| # | Pertanyaan | Sumber |
|---|---|---|
| 1 | ~~Chain utama: EVM (Base) atau Solana?~~ | ✅ Terjawab sesi ini: **Robinhood Chain** (Arbitrum Orbit, EVM-compatible) -- lihat `contracts/README.md` §Chain target |
| 2 | Target user: tim internal dulu atau client eksternal dari awal? | handoff §10 |
| 3 | Token Wright launch saat registrasi, atau nunggu rank tertentu (mis. Journeyman)? | handoff §10 |
| 4 | Siapa penengah dispute sebelum Council terbentuk? | handoff §10 |
| 5 | Model bisnis: fee per peluncuran / langganan / persentase revenue? | konsep-id §Pertanyaan |

---

## Ringkasan angka
- **Selesai:** 18 dari ±44 item total *(Fase 0 + seluruh 11 langkah Fase 1 + Fase 2 item 1, 2, 3 & 5 + Fase 3 item 3, 4 & 5)*, plus Fase 2 item 4 dirintis (script jadi & direhearsal penuh, belum broadcast sungguhan)
- **Fase 1: selesai semua (11/11)** ✅
- **Fase 2: 4/8 selesai dan terverifikasi (item 1, 2, 3, 5), item 4, 6, 7, 8 sebagian** *(46/46 test Forge lulus + `slither .` nol temuan + deploy script direhearsal penuh di Anvil lokal)*
- **Fase 3: 3/5 selesai dan terverifikasi (item 3, 4, 5)** *(`tsc`/`eslint`/`next build` lulus sesi ini -- lihat catatan di atas; belum diverifikasi terhadap Supabase sungguhan)*, item 1-2 (`WageholdRegistry`, daftarkan Wright on-chain) belum disentuh
- **Belum tersentuh sama sekali:** Fase 4, track Legal & Brand, Launch Foundry

Kandidat lanjutan:
- **Jalankan migrasi `0008_all_wards_live.sql` di Supabase kamu**, lalu coba Post a Job di salah satu Ward selain Research (Chain/Craft/Watch/Hearth) untuk membuktikan item 4-5 sungguhan di luar sandbox ini (lihat "BELUM diverifikasi" di catatan item 5).
- **Perbaiki bug Splitter + dispute parsial** (temuan Fase 2 item 8): ubah kontrak + tes Forge + redeploy; jalankan ulang `npm run e2e:local -- --with-finding` sampai S5 lulus tanpa temuan.
- **Fase 2 item 4 (sisa)** -- broadcast sungguhan ke Robinhood Chain testnet: isi `contracts/.env` (API key Alchemy, wallet testnet berisi ETH faucet), lalu `forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --verify --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api` dari mesin dengan akses jaringan ke domain itu. Script-nya sendiri sudah selesai & direhearsal, lihat `contracts/DEPLOY_REHEARSAL.md`.
- **Fase 3 item 1-2** -- kontrak `WageholdRegistry` + daftarkan 20 Wright on-chain, ditunda sampai kamu siap keluar dari mode simulasi (sama seperti Fase 2 item 4).

Mau saya lanjut ke salah satu di atas, atau ada prioritas lain?
