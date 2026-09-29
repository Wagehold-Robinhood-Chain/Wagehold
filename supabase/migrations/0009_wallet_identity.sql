-- Tanpa login: pemilik job tidak lagi Supabase Auth user.
-- Jalankan setelah 0001-0008. Aman dijalankan ulang.
--
-- jobs.client_id sebelumnya `uuid references auth.users`. Sekarang teks bebas
-- yang berisi salah satu dari:
--   * alamat wallet lowercase (`0x...`)  -> mode on-chain (Strongbox terkonfigurasi);
--                                          diambil dari `client` di kontrak, bukan dari request
--   * `sim:<hash>`                       -> mode simulasi; hash SHA-256 dari cookie
--                                          `wh_sim` (httpOnly) milik browser pembuat job
--
-- Job lama (client_id = uuid user Supabase) tetap tersimpan dan tetap terbaca,
-- tapi tidak ada yang bisa men-seal-nya lagi karena pemiliknya sudah tidak ada.

-- Policy lama dari 0001 (sudah di-drop oleh 0005, diulang di sini supaya
-- ALTER TYPE tidak tersangkut kalau 0005 belum pernah dijalankan).
drop policy if exists "clients can insert their own jobs" on jobs;
drop policy if exists "clients can update their own jobs" on jobs;

alter table jobs drop constraint if exists jobs_client_id_fkey;
alter table jobs alter column client_id type text using client_id::text;

create index if not exists jobs_client_id_idx on jobs (client_id);
