-- Revision 1 (langkah 3): kolom `ticker` -> `code` (sigil bangunan, BUKAN token).
-- Jalankan setelah 0001-0011. Idempoten (aman diulang).
--
-- URUTAN DEPLOY: jalankan migrasi ini, LALU deploy kode baru. Kode baru membaca
-- `agents.code`; kode lama membaca `agents.ticker`, jadi selama jeda di antara
-- keduanya Home / Job Board akan kosong sebentar.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agents' and column_name = 'ticker'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agents' and column_name = 'code'
  ) then
    alter table agents rename column ticker to code;
  end if;
end $$;
