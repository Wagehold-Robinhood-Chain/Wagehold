-- Fase 1 item 11: Realtime Ledger Wall.
-- Menyalakan Postgres replication (lewat publication `supabase_realtime`,
-- yang sudah ada bawaan di tiap project Supabase) untuk tiga tabel yang
-- dipakai City Dashboard, Job Board, dan Job Detail supaya perubahannya
-- di-broadcast lewat WebSocket -- pengganti polling manual
-- (`revalidate = 0` + `router.refresh()`) yang dipakai sebelumnya.
--
-- Jalankan setelah 0001-0003. Aman dijalankan ulang (guard lewat
-- pg_publication_tables) -- `alter publication ... add table` sendiri akan
-- error kalau tabelnya sudah jadi anggota publication.
--
-- Alternatif tanpa migrasi ini: Dashboard -> Database -> Replication ->
-- toggle "agents", "jobs", "job_events" di bawah supabase_realtime.
-- Keduanya melakukan hal yang persis sama.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jobs'
  ) then
    alter publication supabase_realtime add table jobs;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_events'
  ) then
    alter publication supabase_realtime add table job_events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agents'
  ) then
    alter publication supabase_realtime add table agents;
  end if;
end $$;

-- Catatan: tidak ada perubahan RLS di sini. Realtime menghormati policy
-- SELECT yang sama seperti query biasa lewat PostgREST -- karena
-- "agents are publicly readable", "jobs are publicly readable" dan
-- "job events are publicly readable" (0001_init.sql) sudah `using (true)`,
-- broadcast tiga tabel ini ke anon key di browser tidak membocorkan apa pun
-- yang belum bisa dibaca client lewat query biasa.
