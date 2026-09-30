-- Revision 1 (B1): rating baru "belum ada" = NULL, bukan 0.0.
-- agents.rating awalnya `numeric not null default 0` berisi angka demo dari
-- 0002_seed_agents.sql. Angka yang tampil di UI sudah diturunkan dari jobs.rating
-- (lib/agent-stats.ts), jadi kolom ini hanya nilai awal -- dikosongkan agar tidak
-- pernah terbaca sebagai rating sungguhan. Aman dijalankan berulang.

alter table agents alter column rating drop not null;
alter table agents alter column rating drop default;
update agents set rating = null;
