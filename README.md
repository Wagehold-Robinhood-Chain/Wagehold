# Wagehold

> Work sealed. Wages shared.

Fase 1 (rebuild `wagehold-prototype.html` jadi produk sungguhan) selesai semua. Stack: **Next.js 16 (App Router) + Tailwind v4 + Motion (dulu Framer Motion) + Supabase**, versi terbaru per 26 September 2026.

Fase 2 (Strongbox on Testnet) sudah dimulai -- kontrak Solidity ada di workspace Foundry terpisah, `contracts/` (lihat `contracts/README.md`). Belum ada sambungan apa pun ke app Next.js di bawah ini; payout masih simulasi database sampai Fase 2 item 6-7 selesai.

## Menjalankan setup ini

```bash
npm install
cp .env.local.example .env.local
# isi NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY dari Supabase dashboard
# isi NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID dari https://cloud.reown.com (gratis) -- opsional
#   untuk menjalankan app, tapi tanpa ini tombol "Connect wallet" nonaktif
npm run dev
```

Buka `http://localhost:3000` — akan muncul kartu "Setup check" yang memverifikasi Tailwind, Framer Motion, koneksi Supabase, dan env wallet connect.

## Supabase

1. Buat project baru di [supabase.com](https://supabase.com).
2. Jalankan `supabase/migrations/0001_init.sql` lewat SQL editor (bikin tabel `agents`, `jobs`, `job_events` sesuai data model di `wagehold-handoff.md` §5).
3. Setelah schema jadi, generate tipe TypeScript yang sesungguhnya:
   ```bash
   npx supabase login
   npm run supabase:types
   ```
   Ini akan menimpa `types/database.ts` (yang sekarang masih placeholder manual).
4. Isi tabel `agents` dengan roster demo dari `wagehold-handoff.md` §7 (20 Wright, 5 Ward).
5. **Aktifkan Email OTP / magic link**: di Supabase dashboard, buka **Authentication → Providers → Email** dan pastikan menyala (nyala secara default di project baru). Lalu di **Authentication → URL Configuration**, tambahkan `http://localhost:3000/auth/callback` (dan URL produksi nanti) ke **Redirect URLs** -- tanpa ini, link di email magic link akan ditolak Supabase saat `signInWithOtp` dipanggil dari `components/login-form.tsx`.
6. **Nyalakan Realtime**: jalankan `supabase/migrations/0004_realtime_ledger.sql` (setelah 0001-0003), atau toggle manual di **Database → Replication** untuk tabel `jobs`, `job_events`, `agents` -- lihat bagian **Realtime Ledger Wall** di bawah.

## Struktur folder

```
app/
  layout.tsx        Root layout, font (Bricolage Grotesque, IBM Plex Sans, Martian Mono)
  page.tsx           Page A — City Dashboard
  agents/
    [id]/
      page.tsx           Page E — Wright Profile
  login/
    page.tsx           Login (magic link)
  auth/
    callback/
      route.ts           Menukar code magic link jadi sesi (PKCE)
  jobs/
    page.tsx           Page B — Job Board
    new/
      page.tsx           Page C — Post a Job
    [id]/
      page.tsx           Page D — Job Detail / Seal Gate
  globals.css        Reset dasar + Tailwind layers
  api/
    agents/            GET /api/agents, GET /api/agents/[id]
    jobs/               GET+POST /api/jobs, GET /api/jobs/[id], approve/, revise/
components/
  ui/                Panel, Button, Badge, Chip, StatusPill, ProgressBar, EmptyState
  stat-bar.tsx, ledger-wall.tsx, job-tabs.tsx, job-card.tsx, job-board.tsx, job-detail.tsx,
  revenue-split.tsx, sparkline.tsx, post-job-form.tsx, post-job-client.tsx, site-nav.tsx,
  agent-profile.tsx, auth-status.tsx, login-form.tsx
  realtime-city-dashboard.tsx  Page A penuh, live lewat Supabase Realtime (Item 11)
  realtime-job-board.tsx       Page B penuh, live lewat Supabase Realtime (Item 11)
  realtime-job-detail.tsx      Page D penuh, live lewat Supabase Realtime (Item 11)
lib/
  cn.ts               Helper gabung className
  supabase/
    client.ts         Supabase client untuk Client Component
    server.ts          Supabase client untuk Server Component / Route Handler (+ service role)
    queries.ts          Query & mutasi bersama, dipakai semua Route Handler
    realtime.ts          Hook `useRealtimeChanges` -- subscribe postgres_changes (Item 11)
    use-current-user-id.ts  Hook lacak user id lewat onAuthStateChange (dipakai komponen realtime)
  agents/
    gemini.ts           Klien REST tipis ke Gemini API (tier gratis)
    research-wright.ts  Runtime Deepdive ($DIVE) -- assign, panggil Gemini, tulis deliverable + Ledger
supabase/
  migrations/
    0001_init.sql      Schema awal: agents, jobs, job_events + RLS
    0002_seed_agents.sql  Seed 20 Wright / 5 Ward (roster demo)
    0003_research_wright_live.sql  Kolom `deliverable` + system_prompt/model Deepdive untuk Gemini
    0004_realtime_ledger.sql  Nyalakan Supabase Realtime untuk jobs/job_events/agents (Item 11)
    0005_harden_rls.sql       Cabut hak tulis browser ke jobs/agents/job_events; batas panjang title/brief
types/
  database.ts          Tipe DB (placeholder, ganti dengan hasil generate)
  domain.ts             Tipe UI (AgentSummary, JobSummary, LedgerEvent, dst)
proxy.ts                 Refresh sesi Supabase tiap request (dulu middleware.ts)
eslint.config.mjs        Flat config ESLint 9

contracts/                Workspace Foundry terpisah (Fase 2) -- lihat contracts/README.md
  src/WageholdStrongbox.sol   Kontrak escrow (Fase 2 item 1)
  test/WageholdStrongbox.t.sol  24 test Forge, termasuk 1 fuzz test
```

## Token desain

Tailwind v4 tidak lagi pakai `tailwind.config.ts` — semua token warna/font ada di `app/globals.css` lewat blok `@theme`, diambil langsung dari `:root` di `wagehold-prototype.html` supaya port ke React tidak mengubah identitas visual yang sudah disepakati. Rujuk `wagehold-lore.md` §8 (UI copy dictionary) saat menulis teks tombol/label.

## Catatan versi (per 26 September 2026)

Beberapa paket berubah cukup besar dari versi yang umum beredar di tutorial lama — kalau nemu contoh kode yang beda, ini alasannya:

- **Next.js 16**: `cookies()` sekarang **async** (`await cookies()`), `params` di Route Handler & page juga **async** (`await params`), dan `middleware.ts` sudah diganti nama jadi **`proxy.ts`** (fungsi ekspornya `proxy`, bukan `middleware`).
- **Tailwind v4**: config lewat CSS (`@theme` di `globals.css`), bukan file JS. PostCSS plugin-nya `@tailwindcss/postcss`, bukan `tailwindcss` + `autoprefixer`.
- **Framer Motion → Motion**: nama paket npm sekarang `motion`, import dari `"motion/react"` (bukan `"framer-motion"`). Tim & fitur sama.
- **@supabase/ssr**: pola cookie sekarang `getAll`/`setAll`, menggantikan `get`/`set`/`remove` yang lama.
- **Proxy bukan lapis auth**: karena CVE-2025-29927, tiap Route Handler yang butuh user login memanggil `supabase.auth.getUser()` sendiri (lihat `lib/supabase/queries.ts` & catatan di `proxy.ts`), tidak cukup mengandalkan proxy saja.

## Komponen dasar

15 komponen yang dipakai berulang di seluruh page, di `components/ui/` (primitif) dan `components/` (spesifik domain):

| Komponen | File |
|---|---|
| Panel, PanelHeader, PanelScroll | `components/ui/panel.tsx` |
| Button | `components/ui/button.tsx` |
| Badge | `components/ui/badge.tsx` |
| Chip | `components/ui/chip.tsx` |
| StatusPill | `components/ui/status-pill.tsx` |
| ProgressBar | `components/ui/progress-bar.tsx` |
| EmptyState | `components/ui/empty-state.tsx` |
| StatBar | `components/stat-bar.tsx` |
| LedgerWall | `components/ledger-wall.tsx` |
| JobTabs | `components/job-tabs.tsx` |
| JobCard | `components/job-card.tsx` |
| RevenueSplit | `components/revenue-split.tsx` |
| Sparkline | `components/sparkline.tsx` |
| PostJobForm | `components/post-job-form.tsx` |
| PostJobClient | `components/post-job-client.tsx` |
| JobBoard | `components/job-board.tsx` |
| JobDetail | `components/job-detail.tsx` |
| SiteNav | `components/site-nav.tsx` |

Cek semuanya sekaligus di `npm run dev` → `http://localhost:3000/dev/components`. Halaman ini sementara, hapus `app/dev/` setelah page sungguhan (City Dashboard, Job Board, dst) selesai dan memakai komponen-komponen ini langsung.

Tipe domain (`AgentSummary`, `JobSummary`, `LedgerEvent`, dst) ada di `types/domain.ts`, terpisah dari `types/database.ts` (bentuk row Supabase) supaya komponen tidak terikat langsung ke schema DB.

## Route Handler (API)

| Method & path | Fungsi | Auth |
|---|---|---|
| `GET /api/agents` | Daftar semua Wright | Publik |
| `GET /api/agents/:id` | Profil satu Wright | Publik |
| `GET /api/jobs` | Daftar job, filter `?status=review,working` | Publik |
| `GET /api/jobs/:id` | Detail job + timeline (`job_events`) | Publik |
| `POST /api/jobs` | Post a job — mengunci wage (Article III) | Wajib login |
| `POST /api/jobs/:id/approve` | Set the seal (Article I) — hanya client pemilik job | Wajib login |
| `POST /api/jobs/:id/revise` | Send back, kembali ke status `working` | Wajib login |

Logika query dipusatkan di `lib/supabase/queries.ts` supaya tidak duplikat antar Route Handler. Payout (approve) masih **simulasi di database** — kredit 70% ke `agents.revenue_30d` — bukan transaksi atomik. Di Fase 2, ini digantikan `WageholdSplitter` on-chain sungguhan.

`POST /api/jobs` dan `POST /api/jobs/:id/revise` sekarang juga memicu `runResearchJob()` (lihat **Research Ward (live agent)** di bawah) kalau job-nya `district: "research"` -- request-nya jadi lebih lambat beberapa detik (menunggu Gemini), tapi client langsung melihat hasilnya begitu redirect selesai.

Route Handler yang butuh login memvalidasi `supabase.auth.getUser()` sendiri, tidak hanya mengandalkan `proxy.ts` (lihat catatan CVE-2025-29927 di file itu). Sejak halaman login dibangun (lihat bagian **Login (magic link)** di bawah), endpoint-endpoint ini bisa dites sungguhan dari browser, bukan cuma lewat client Supabase yang bawa sesi manual.

## Data seed

`supabase/migrations/0002_seed_agents.sql` mengisi 20 Wright / 5 Ward sesuai roster demo di `wagehold-handoff.md` §7. Jalankan setelah `0001_init.sql`.

## Page A — City Dashboard

`app/page.tsx` (Server Component) hanya mengambil data awal (agents/jobs/events lewat `lib/supabase/queries.ts`) dan meneruskannya ke **`components/realtime-city-dashboard.tsx`** (Client Component), yang menurunkan status tiap agent (`idle`/`working`/`review`) dari job aktifnya lalu merender:

- **`components/city-scene.tsx`** — port scene Three.js dari `wagehold-prototype.html`: kota isometrik, 5 Ward melingkar, gedung per Wright (tinggi = pendapatan, cahaya jendela = status kerja, beacon amber = awaiting seal). Kamera bisa di-drag (orbit) dan di-scroll (zoom). Klik gedung → navigasi ke `/agents/[id]` (Page E, sekarang sudah ada -- lihat di bawah).
- **StatBar** — Counting House, In the Strongbox, Sealed jobs, Wrights at work (dihitung langsung dari data jobs/agents)
- **LedgerWall** — 20 event terbaru lintas semua job

Sejak Item 11, ketiganya bergerak **live** lewat Supabase Realtime (lihat bagian **Realtime Ledger Wall**) -- bukan lagi cuma di render awal.

Catatan versi Three.js: `renderer.outputEncoding` di prototipe (API lama) diganti `renderer.outputColorSpace = THREE.SRGBColorSpace`, karena `outputEncoding` sudah dihapus sejak Three.js r152 (versi kita 0.184.0 jauh di atas itu).

"Counting House" di StatBar masih **estimasi** (10/70 dari total `revenue_30d` yang sudah tercatat), bukan angka treasury sungguhan -- akan diganti begitu ada tabel/endpoint treasury (Fase 2).

## Page B — Job Board

`app/jobs/page.tsx` (Server Component) hanya mengambil semua job lewat `listJobs(supabase)` (tanpa filter status, supaya jumlah di tiap tab akurat), ticker tiap agent, dan `supabase.auth.getUser()`, lalu meneruskannya sebagai data awal ke **`components/realtime-job-board.tsx`** (Client Component).

- `isOwnJob` per job (`job.client_id === user.id`) dihitung ulang di client lewat `useCurrentUserId` (lacak sesi sendiri, lihat bagian Realtime), sejalan dengan cek auth yang sama di Route Handler `approve`/`revise`.
- **`components/job-board.tsx`** (Client Component) -- render 4 tab sesuai `wagehold-handoff.md` §3: *Awaiting seal* (`review`), *In progress* (`working`), *Open* (`open`), *Sealed* (`paid`). Tiap tab pakai `EmptyState` dengan copy dari kamus lore (`wagehold-lore.md` §8). Tombol **Post a job** menuju `/jobs/new` (Page C, lihat di bawah).
- **`components/job-card.tsx`** -- diperluas: kalau `isOwnJob` dan job `review`, muncul **Set the seal** / **Send back**. *Send back* sekarang minta catatan revisi dulu (textarea inline) sebelum dikonfirmasi, karena `POST /api/jobs/:id/revise` mewajibkan `note` (Charter IV: setiap aksi tercatat). Tombol nonaktif dan berganti teks selagi request jalan (`busy`), dan menampilkan pesan error kalau request gagal (mis. mencoba set the seal padahal bukan pemilik job).
- Aksi seal memanggil `POST /api/jobs/:id/approve` atau `/revise` lewat `fetch`, lalu `router.refresh()` sebagai fallback -- tapi begitu Route Handler menulis ke `jobs`/`job_events`, tab ini (dan semua tab/device lain yang sedang membuka Job Board atau City Dashboard) sudah lebih dulu ter-update lewat Realtime (Item 11), bukan menunggu refresh itu.
- **`components/site-nav.tsx`** -- nav kecil (*The City* / *Job Board*) ditambahkan ke header Page A dan Page B supaya kedua page saling terhubung.
- `isOwnJob` sekarang sungguhan: begitu login (lihat bagian **Login (magic link)**), gerbang seal muncul untuk job milik sendiri. Sebelum login, job board tetap terlihat penuh tapi read-only, dengan link **Sign in** kecil di atas daftar job.

## Page C — Post a Job

`app/jobs/new/page.tsx` (Server Component shell: header + nav + footer) merender `components/post-job-client.tsx` (Client Component) di dalam sebuah `Panel`, yang membungkus `PostJobForm` (sudah ada dari sebelumnya) dengan pemanggilan `POST /api/jobs`.

- Berhasil → `router.push("/jobs")` + `router.refresh()`, jadi job baru langsung terlihat di tab *Open* Job Board.
- Gagal → pesan error tampil di bawah form. Kalau belum login, Route Handler balik `"Sign in to post a job"` (401) -- errornya sekarang berisi link langsung ke `/login`.
- Panel diberi caption *"The Gate -- where clients enter to post jobs..."* mengikuti **clarity rule** di `wagehold-lore.md` §8: istilah lore (*The Gate*, *Strongbox*, *set the seal*) disandingkan dengan arti polosnya begitu pertama kali muncul di layar.
- Tombol **Cancel** kembali ke `/jobs` (Job Board) tanpa submit.

## Page D — Job Detail / Seal Gate

`app/jobs/[id]/page.tsx` (Server Component) memanggil `getJobById(supabase, id)` untuk job + timeline (`job_events`) awal, dan kalau job sudah punya `agent_id`, memanggil `getAgentById` terpisah supaya bisa tampilkan nama & rank Wright (bukan cuma ticker seperti di Job Board). `notFound()` dipanggil kalau job tidak ada. Data awal itu diteruskan ke **`components/realtime-job-detail.tsx`** (Client Component).

- **`components/job-detail.tsx`** merender ulang `JobCard` (dari Page B) sebagai ringkasan + gerbang seal -- satu-satunya tempat logika Set the seal/Send back ditulis, dipakai ulang di sini lewat prop `linkToDetail={false}` (supaya tidak me-link ke dirinya sendiri). Di bawahnya: **Brief** lengkap, **Wright** yang mengerjakan (nama, ticker, rank chip, link ke `/agents/[id]` -- Page E, sekarang sudah ada), dan **Ledger** khusus job ini (bukan lintas job seperti di City Dashboard).
- `components/job-card.tsx` diperluas lagi: judul job sekarang jadi link ke `/jobs/[id]`, baik dari Job Board maupun City Dashboard.
- Timeline awal diformat jadi string di server (`toLocaleString`) supaya tidak ada risiko hydration mismatch locale/timezone; event yang datang belakangan lewat Realtime diformat di browser (baris itu memang tidak pernah ikut SSR, jadi aman).
- Sejak Item 11, `status`, `progress`, `deliverable`, dan Ledger job ini semua live lewat Supabase Realtime (filter `id=eq.<jobId>` / `job_id=eq.<jobId>`) -- klien yang membuka halaman job Research Ward-nya melihat Deepdive bergerak `open → working → review` tanpa refresh, meski prosesnya berjalan di request `POST /api/jobs` yang berbeda.
- Sama seperti Page B: `isOwnJob` sekarang sungguhan begitu login -- gerbang seal bisa dites sungguhan.

## Page E — Wright Profile

`app/agents/[id]/page.tsx` (Server Component) memanggil `getAgentById` untuk data Wright, plus semua job miliknya lewat `listJobsByAgent` (query baru di `queries.ts`) untuk menurunkan status kerja saat ini (idle/working/review, logika sama seperti City Dashboard) dan daftar **Sealed jobs**. `notFound()` dipanggil kalau agent tidak ada.

- **`components/agent-profile.tsx`** -- ticker, Ward, chip rank (atau "Warden" kalau `is_lead`), status pill, deskripsi, `StatBar` (revenue 30d, Patrons, rating, sealed jobs), dan **Wage split** (`RevenueSplit`) dengan angka tetap 70/20/10 dari Charter -- bukan kolom di tabel `agents`, karena splitnya sama untuk semua Wright. Sealed jobs list-nya pakai ulang `JobCard` (read-only).
- Tombol **Hire $TICKER** mengarah ke `/jobs/new?district=<ward-agent-ini>` -- belum meng-assign job langsung ke Wright itu (routing per-Wright masih tugas Warden, Fase 3), jadi baru mem-prefill Ward di form Post a Job.
- **Tidak ada** token price / 14-hari sparkline seperti di panel profil prototipe -- `types/database.ts` tidak punya kolom harga atau tabel riwayat harga. Butuh tabel baru (mis. `agent_price_history`), ditunda sampai Fase 4 (tokenisasi agent).

## Login (magic link)

`app/login/page.tsx` + `components/login-form.tsx` -- form email saja, tanpa password. Memanggil `supabase.auth.signInWithOtp()` dari browser client (`lib/supabase/client.ts`), Supabase mengirim link ke email. Kalau sudah login, `/login` redirect ke `/`.

- `app/auth/callback/route.ts` -- Route Handler yang menerima redirect dari link email (`?code=...`), menukarnya jadi sesi sungguhan lewat `supabase.auth.exchangeCodeForSession()` (PKCE), lalu redirect ke `next` (default `/`). Gagal (link kadaluarsa/sudah dipakai) → balik ke `/login?error=auth_failed` dengan pesan error di atas form.
- **`components/auth-status.tsx`** -- dipasang di header semua 5 page. Client Component: cek sesi lewat `supabase.auth.getUser()` saat mount, lalu dengar `supabase.auth.onAuthStateChange()` supaya begitu magic link diklik atau tombol **Sign out** ditekan, statusnya (dan semua Server Component di halaman yang sama lewat `router.refresh()`) ikut ter-update tanpa reload manual. Belum login → link **Sign in**. Sudah login → email (disembunyikan di layar sempit) + tombol **Sign out**.
- Semua pesan "login belum ada" di Page B/C/D sudah diganti jadi link langsung ke `/login`.
- **Belum ada**: halaman profil/pengaturan akun, dan belum ada provider selain email magic link (mis. OAuth Google/GitHub) -- di luar scope item 9.

## Research Ward (live agent)

Fase 1 item 10: **Deepdive ($DIVE)**, Wright Journeyman di Research Ward, sekarang benar-benar mengerjakan job -- bukan simulasi. Item brief aslinya minta "Claude API", tapi diganti AI gratisan (**Google Gemini**, tier gratis Google AI Studio) supaya bisa jalan tanpa API key berbayar.

**Setup:**
1. Ambil API key gratis di [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Isi `GEMINI_API_KEY=` di `.env.local`.
3. Jalankan `supabase/migrations/0003_research_wright_live.sql` (setelah 0001 & 0002) -- ini menambah kolom `jobs.deliverable` dan mengisi `system_prompt`/`model` milik Deepdive, yang sebelumnya kolom kosong tak terpakai.

**Alur (`lib/agents/research-wright.ts`, dipanggil dari `POST /api/jobs` dan `POST /api/jobs/:id/revise`):**
1. Job baru dengan `district: "research"` dan status `open` → di-assign ke Deepdive (`agent_id` diisi, status → `working`), dicatat sebagai event `assigned` di Ledger.
2. `lib/agents/gemini.ts` memanggil Gemini (`generateContent`, model dari `agents.model` yaitu `gemini-3.8-flash`) dengan `agents.system_prompt` sebagai system instruction dan judul+brief+budget job sebagai user prompt.
3. Berhasil → jawabannya disimpan di `jobs.deliverable`, status → `review`, event `submitted` -- client bisa membacanya di panel **Deliverable** baru di Page D sebelum Set the seal.
4. **Send back** (revise) → status balik `working`, Deepdive dipanggil ulang dengan catatan revisi client disisipkan ke prompt (dicari dari event `sent_back` terakhir), lalu jalan lagi dari langkah 2.
5. Gagal (API key kosong, timeout, Gemini error) → job **kembali ke `open`** (bukan macet di `working`), event `error` tercatat menyebutkan alasannya. Wage tetap aman di Strongbox (Charter I) -- job bisa dites lagi dengan mengulang atau memposting ulang.

**Yang sengaja belum dikerjakan:**
- **Ward lain** (Chain, Craft, Watch, Hearth) masih diam di `open` -- runtime-nya masing-masing ditunda ke Fase 3 item 4. Kode di `research-wright.ts` sengaja langsung `return` kalau `job.district !== "research"`.
- **Routing multi-Wright** (Warden memilih Wright yang paling cocok, bukan selalu Deepdive) -- itu Fase 3 item 5. Untuk sekarang satu Ward = satu Wright yang hidup.
- **Retry UI**: kalau gagal, satu-satunya cara mencoba lagi adalah **Send back** (setelah pernah berhasil sekali) atau memposting ulang job baru -- belum ada tombol "coba lagi" langsung di job yang gagal di percobaan pertama.
- Ganti ke Claude API sungguhan tinggal menulis `lib/agents/claude.ts` senada dengan `gemini.ts` dan menukar importnya satu baris di `research-wright.ts`.

## Realtime Ledger Wall (Item 11)

Fase 1 item 11: City Dashboard, Job Board, dan Job Detail sekarang mendengar perubahan database lewat **Supabase Realtime** (WebSocket, lewat Postgres logical replication) -- pengganti pola `revalidate = 0` + `router.refresh()` manual yang dipakai sebelumnya.

**Setup (sekali saja, setelah 0001-0003):**
```bash
# jalankan lewat SQL editor Supabase, atau `supabase db push`
supabase/migrations/0004_realtime_ledger.sql
```
Ini menyalakan tiga tabel (`jobs`, `job_events`, `agents`) di publication `supabase_realtime`. Alternatif tanpa migrasi: Dashboard → **Database → Replication**, toggle ketiga tabel itu secara manual di bawah `supabase_realtime` -- efeknya sama persis. Tidak ada env var baru; jalur ini pakai `NEXT_PUBLIC_SUPABASE_ANON_KEY` yang sama seperti query biasa, dan tetap tunduk pada RLS -- policy SELECT ketiga tabel itu sudah `using (true)` sejak `0001_init.sql`, jadi tidak ada data baru yang terekspos.

**Cara kerjanya (`lib/supabase/realtime.ts`):**
- `useRealtimeChanges(table, onChange, filter?)` -- hook generik, `.channel(...).on("postgres_changes", {event: "*", schema: "public", table, filter}, ...)`. `filter` opsional bergaya PostgREST (mis. `job_id=eq.<id>`) dipakai Job Detail supaya cuma dengar event job itu sendiri, bukan seluruh kota.
- Tiga komponen `realtime-*.tsx` masing-masing menyimpan data awal dari Server Component (`initial*` props) sebagai state, lalu meng-upsert/prepend state itu tiap event `postgres_changes` masuk -- tidak query ulang ke Supabase, cukup pakai payload yang sudah dikirim lewat WebSocket.
- `lib/supabase/use-current-user-id.ts` melacak user id lewat `onAuthStateChange` secara independen di tiap komponen realtime, supaya gerbang seal (`isOwnJob`) tetap benar begitu user sign in/out -- tidak bergantung ke `router.refresh()` dari `AuthStatus`, yang tidak menyentuh state client yang sudah diinisialisasi dari props awal.

**Yang sekarang terasa bedanya:** memposting job Research Ward memicu `POST /api/jobs` yang menunggu Deepdive selesai lewat Gemini sebelum request itu sendiri selesai (lihat bagian Research Ward). Selama itu, siapa pun yang sedang membuka Job Board, City Dashboard, atau halaman job itu langsung melihat statusnya bergerak `open → working → review`, progress bar bergerak, dan panel **Deliverable** muncul -- tanpa refresh manual sama sekali, termasuk dari tab/device lain.

**Keterbatasan yang diketahui (bukan bug, bawaan platform):**
- Ada race condition kecil di Supabase Realtime: event yang ditulis dalam ~1-3 detik pertama setelah sebuah channel baru selesai `SUBSCRIBED` kadang tidak terkirim ([supabase-js#1599](https://github.com/supabase/supabase-js/issues/1599)). Dalam alur normal (buka halaman dulu, baru posting job dari halaman lain) ini jarang kerasa, tapi kalau kejadian, refresh manual tetap jadi fallback yang aman.
- Belum ada indikator "live" atau status koneksi channel di UI -- kalau WebSocket putus (mis. laptop sleep), tidak ada tanda visual selain data berhenti bergerak. Reconnect otomatis ditangani `supabase-js`, tapi belum ada toast/badge yang mengonfirmasinya ke pengguna.

## Wallet connect (Fase 2 item 5)

Tombol **Connect wallet** di header semua halaman (di sebelah Sign in/Sign out), memakai **Reown AppKit** (WalletConnect + wallet browser seperti MetaMask) di atas wagmi/viem.

- `lib/web3/chains.ts` -- Robinhood Chain testnet (46630) & mainnet (4663) sebagai custom chain. RPC default endpoint publik; override lewat `NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL`/`..._MAINNET_RPC_URL` (mis. URL Alchemy, **domain-restrict dulu key-nya** karena `NEXT_PUBLIC_*` terlihat di browser).
- `lib/web3/config.ts` -- `WagmiAdapter` (cookie storage + SSR), `isWeb3Configured`.
- `components/web3-provider.tsx` -- `WagmiProvider` + `QueryClientProvider` + `createAppKit()`, dipasang di `app/layout.tsx`.
- `components/wallet-connect.tsx` -- tombol connect / alamat terpotong / "Wrong network" / disconnect.
- **Tanpa `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`** app tetap jalan normal; tombolnya tampil nonaktif dengan petunjuk, dan Setup check menandai "Wallet connect env" gagal.
- **Hanya koneksi.** Belum membaca saldo / mengirim transaksi -- itu Fase 2 item 6-7 (Post a Job mengunci wage di `WageholdStrongbox`, Set the seal melepas escrow).

Catatan teknis `next.config.mjs` (Next 16 / Turbopack): `serverExternalPackages` menggantikan `webpack.externals` yang disarankan docs Reown (Turbopack menolak config `webpack` tanpa `turbopack`), dan `turbopack.resolveAlias` men-stub paket opsional `@x402/*` yang ditarik konektor Coinbase di wagmi (tidak dipakai, tidak ter-install, tanpa alias build gagal "Module not found").

## Set the seal on-chain (Fase 2 item 7)

Untuk job yang wage-nya sudah terkunci on-chain (`escrow_tx` terisi, item 6), **Set the seal** sekarang melepas escrow di `WageholdStrongbox`, bukan cuma mengubah status di database. Alurnya tiga langkah, semuanya dijalankan oleh `setTheSeal()` di `lib/web3/set-the-seal.ts` (dipakai Job Board dan Job Detail):

1. **`POST /api/jobs/:id/seal/prepare`** -- `approve()` di kontrak revert `PayeeNotSet` sampai council mendaftarkan payee. Route ini (hanya untuk client pemilik job, status `review`) memakai `COUNCIL_PRIVATE_KEY` untuk `setPayee` -- dan `registerJob` di Splitter kalau `WAGEHOLD_SPLITTER_ADDRESS` diisi. Payee dihitung dari database (Wright yang di-assign), tidak pernah dari body request. Idempotent.
2. **Wallet client mengirim `approve(jobId)`** ke Strongbox (`sealOnChain`). Hanya wallet yang mengunci wage yang bisa (Charter I, `NotClient` kalau bukan). Revert kontrak diterjemahkan jadi pesan yang bisa dibaca.
3. **`POST /api/jobs/:id/approve`** dengan `sealTx` -- server membaca ulang chain (`lib/web3/verify-release.ts`), hanya kalau status `Released` job ditandai `paid`. Setelah itu `pullAndSplit` dipanggil (permissionless): Patrons 70 / Lamp Oil 20 / Tithe 10. Kalau split gagal, seal tetap sah dan event `split_pending` dicatat di Ledger.

Job tanpa escrow on-chain tetap memakai alur simulasi lama (satu langkah). Job on-chain **tidak bisa** ditandai `paid` lewat `/approve` tanpa seal di chain.

Setup yang perlu diisi (lihat `.env.local.example`): `COUNCIL_PRIVATE_KEY` (server-only, harus alamat yang sama dengan `council()` di kontrak), `WAGEHOLD_SPLITTER_ADDRESS`, dan `WAGEHOLD_PATRON_POOL_ADDRESS` kalau `agents.wallet` Wright belum diisi. Event Ledger sekarang menampilkan link explorer untuk tx (lock, seal, split).

## E2E on-chain (Fase 2 item 8)

`scripts/e2e-testnet.ts` menjalankan siklus penuh wage terhadap kontrak yang sudah ter-deploy
(kunci → payee → seal → split → withdraw, plus refund dan dispute), memakai kode server app yang sama
(`verify-lock`, `council`, `verify-release`). `npm run e2e:local` = Anvil + deploy + dua mode; `npm run e2e` /
`npm run e2e:direct` untuk RPC testnet. Panduan lengkap, cara baca kegagalan, temuan Splitter + dispute,
dan daftar klik manual di browser ada di [`E2E_TESTNET.md`](./E2E_TESTNET.md).

## Belum termasuk di tugas ini

- Animasi koin terbang ke Counting House saat "Set the seal" (`coins()` di prototipe) — Ledger Wall dan status sudah live (Item 11), tapi animasi koin spesifik itu belum diporting
- Runtime agent untuk 4 Ward selain Research, dan routing multi-Wright per Ward — Fase 3
- Indikator status koneksi Realtime (live/reconnecting) di UI — lihat keterbatasan di bagian Realtime Ledger Wall di atas


## Keamanan (wajib sebelum deploy publik)

- **Jalankan `0005_harden_rls.sql`** (setelah 0001-0004). Sejak itu browser hanya boleh MEMBACA; semua penulisan lewat Route Handler memakai `SUPABASE_SERVICE_ROLE_KEY` setelah `auth.getUser()` dan kepemilikan job dicek. Tanpa `SUPABASE_SERVICE_ROLE_KEY` di environment, Post a job / Set the seal / Send back akan gagal.
- Rahasia server (`SUPABASE_SERVICE_ROLE_KEY`, `COUNCIL_PRIVATE_KEY`, `GEMINI_API_KEY`) hanya di environment variable Vercel (centang *Sensitive*), tidak pernah berawalan `NEXT_PUBLIC_`.
- Batas penyalahgunaan: 10 job baru per user per jam (`app/api/jobs/route.ts`), maksimal 5 "Send back" per job, dan batas panjang title/brief/note.
- Kalau escrow on-chain sudah dikonfigurasi (`NEXT_PUBLIC_STRONGBOX_ADDRESS` terisi), Post a job tanpa lock on-chain ditolak -- alur simulasi hanya untuk lokal.
- Teks dari user yang dirender sebagai HTML (Ledger Wall) di-escape lewat `lib/escape-html.ts`.
- Header keamanan dasar ada di `next.config.mjs`. CSP penuh belum diberlakukan (Reown/WalletConnect memuat banyak domain) -- mulai dengan `Content-Security-Policy-Report-Only` di staging.
