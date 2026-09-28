-- Pengetatan keamanan sebelum deploy publik.
-- Jalankan setelah 0001-0004. Aman dijalankan ulang.
--
-- Masalah di 0001_init.sql: policy INSERT/UPDATE pada `jobs` membolehkan client
-- yang login mengubah baris job miliknya LANGSUNG lewat API Supabase dengan anon
-- key dari browser (mis. status='paid', agent_id, budget_usdc, escrow_tx), tanpa
-- melewati Route Handler yang memverifikasi lock on-chain dan alur seal.
--
-- Setelah migrasi ini SEMUA penulisan ke jobs / agents / job_events hanya lewat
-- Route Handler memakai service role (yang melewati RLS) setelah kepemilikan dan
-- status dicek di kode. Membaca tetap publik (Job Board, City, Ledger Wall,
-- Realtime) -- policy SELECT tidak diubah.

drop policy if exists "clients can insert their own jobs" on jobs;
drop policy if exists "clients can update their own jobs" on jobs;

-- Sabuk pengaman kedua: cabut hak tulis dari role browser. RLS sudah menolak
-- tanpa policy, ini memastikan tetap tertolak kalau suatu saat ada policy salah.
revoke insert, update, delete, truncate on table public.jobs from anon, authenticated;
revoke insert, update, delete, truncate on table public.agents from anon, authenticated;
revoke insert, update, delete, truncate on table public.job_events from anon, authenticated;

-- Batas panjang teks. `not valid` = hanya baris baru yang dicek, jadi data lama
-- yang mungkin lebih panjang tidak membuat migrasi gagal.
alter table jobs drop constraint if exists jobs_title_length;
alter table jobs
  add constraint jobs_title_length check (char_length(title) between 1 and 120) not valid;

alter table jobs drop constraint if exists jobs_brief_length;
alter table jobs
  add constraint jobs_brief_length check (char_length(brief) between 1 and 4000) not valid;
