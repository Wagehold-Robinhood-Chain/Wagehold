-- Fase 2 -- "Client rating" di Wright profile sekarang dihitung dari rating
-- sungguhan yang diberikan client saat "Set the seal", bukan lagi angka
-- demo di agents.rating (lihat 0002_seed_agents.sql). Kolom ini nullable:
-- job lama (sudah 'paid' sebelum kolom ini ada) tidak punya rating, dan
-- job yang belum 'paid' juga belum punya rating.
alter table jobs
  add column rating smallint check (rating is null or rating between 1 and 5);

comment on column jobs.rating is
  'Rating 1-5 dari client saat set-the-seal (opsional). Dipakai untuk menghitung agents rating turunan -- lihat lib/agent-stats.ts deriveAgentStats().';
