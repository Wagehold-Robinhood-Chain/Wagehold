-- Patronage cut-over -- Dev Brief "On-chain Patronage + Hardening" §7.2 (Tahap 4, sesi 4D).
-- Jalankan setelah 0019. Idempoten (aman diulang). TIDAK menghapus data: `stakes` dan `stake_payouts`
-- tetap ada, hanya-baca, supaya "Simulation history" di profil bangunan masih punya sumber.
--
-- Isi:
--   1. patronage_cutover: satu baris penanda kapan simulasi dibekukan (+ nomor blok, diisi manual).
--   2. record_wage_split() ditulis ulang: tidak lagi membaca `stakes` dan tidak menulis `stake_payouts`.
--      Tanda tangan fungsi TETAP, jadi aplikasi lama maupun baru bisa memanggilnya.
--   3. Pembekuan `stakes` / `stake_payouts`: INSERT, UPDATE, dan TRUNCATE ditolak oleh trigger.
--      DELETE tetap boleh, karena `on delete cascade` dari `agents` / `jobs` (membersihkan job uji)
--      tidak boleh ikut gagal.
--   4. stake_wage() / unstake_wage() dihapus (routenya dihapus di kode).
--   5. counting_house_totals(): Counting House dari chain_events, bukan dari wage_splits.
--
-- URUTAN: jalankan migrasi ini SEBELUM men-deploy kode 4D. Kode lama masih jalan di atas migrasi ini
-- (ia hanya membaca `stakes` / `wage_splits`, dan memanggil record_wage_split dengan argumen yang sama).
-- Kode 4D membutuhkan counting_house_totals(). Lihat PATRONAGE_4D.md untuk urutan lengkap + nomor blok.

-- 1. Penanda cut-over ----------------------------------------------------------------------------
create table if not exists patronage_cutover (
  id boolean primary key default true check (id),   -- paksa satu baris
  frozen_at timestamptz not null default now(),
  -- Blok chain saat simulasi dibekukan. Sengaja NULL: SQL tidak tahu kepala chain. Isi dengan
  -- `update patronage_cutover set freeze_block = <N>;` (lihat PATRONAGE_4D.md langkah 4).
  freeze_block bigint,
  note text
);

insert into patronage_cutover (id, note)
values (true, 'Simulated Patronage frozen; on-chain Patronage is the source of truth.')
on conflict (id) do nothing;

alter table patronage_cutover enable row level security;
drop policy if exists "patronage cutover is publicly readable" on patronage_cutover;
create policy "patronage cutover is publicly readable" on patronage_cutover for select using (true);
revoke insert, update, delete, truncate on table public.patronage_cutover from anon, authenticated;

-- 2. record_wage_split baru ----------------------------------------------------------------------
-- Mencatat pembagian 60/20/10/10 satu job yang sudah 'paid' (dasar angka Furnace di kota dan catatan
-- per job). Yang BERUBAH dari 0013: tidak ada pembagian ke staker simulasi. Bagian patron yang sebenarnya
-- dibagi oleh kontrak (Splitter v2 -> Patronage.notifyReward) dan dibaca dari chain, bukan dari sini.
--   * wage_splits.treasury_redirect = 0 dan staker_count = 0 untuk baris baru (kolom dipertahankan
--     karena baris lama memakainya).
--   * Idempoten: job yang sudah punya baris wage_splits -> null.
create or replace function record_wage_split(
  p_job_id uuid,
  p_patrons_pct numeric,
  p_lamp_oil_pct numeric,
  p_tithe_pct numeric,
  p_furnace_pct numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  j jobs%rowtype;
  gross numeric;
  patrons numeric;
  lamp numeric;
  furnace numeric;
  tithe numeric;
begin
  if p_patrons_pct + p_lamp_oil_pct + p_tithe_pct + p_furnace_pct <> 100 then
    raise exception 'split percentages must add up to 100';
  end if;

  select * into j from jobs where id = p_job_id and status = 'paid';
  if not found or j.agent_id is null then
    return null;
  end if;
  if exists (select 1 from wage_splits where job_id = p_job_id) then
    return null;
  end if;

  gross := j.budget_usdc;
  patrons := trunc(gross * p_patrons_pct / 100, 6);
  lamp := trunc(gross * p_lamp_oil_pct / 100, 6);
  furnace := trunc(gross * p_furnace_pct / 100, 6);
  tithe := gross - patrons - lamp - furnace; -- sisa pembulatan masuk tithe

  insert into wage_splits (job_id, agent_id, gross, patrons, lamp_oil, tithe, furnace, treasury_redirect, staker_count)
  values (p_job_id, j.agent_id, gross, patrons, lamp, tithe, furnace, 0, 0);

  return jsonb_build_object(
    'gross', gross,
    'patrons', patrons,
    'lampOil', lamp,
    'tithe', tithe,
    'furnace', furnace
  );
end $$;

revoke all on function record_wage_split(uuid, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function record_wage_split(uuid, numeric, numeric, numeric, numeric) to service_role;

comment on column wage_splits.treasury_redirect is
  'LEGACY (0013): bagian patron simulasi yang tidak terbagi. Selalu 0 untuk baris setelah 0020; Counting House membaca chain_events.';
comment on column wage_splits.staker_count is
  'LEGACY (0013): jumlah staker simulasi saat seal. Selalu 0 untuk baris setelah 0020.';

-- 3. Pembekuan stakes / stake_payouts -----------------------------------------------------------
create or replace function simulation_tables_frozen()
returns trigger
language plpgsql
as $$
begin
  raise exception 'table "%" is frozen: simulated Patronage ended at the on-chain cut-over (migration 0020). It is read-only history.',
    tg_table_name
    using errcode = 'P0001';
end $$;

drop trigger if exists stakes_frozen on stakes;
create trigger stakes_frozen
  before insert or update on stakes
  for each statement execute function simulation_tables_frozen();
drop trigger if exists stakes_frozen_truncate on stakes;
create trigger stakes_frozen_truncate
  before truncate on stakes
  for each statement execute function simulation_tables_frozen();

drop trigger if exists stake_payouts_frozen on stake_payouts;
create trigger stake_payouts_frozen
  before insert or update on stake_payouts
  for each statement execute function simulation_tables_frozen();
drop trigger if exists stake_payouts_frozen_truncate on stake_payouts;
create trigger stake_payouts_frozen_truncate
  before truncate on stake_payouts
  for each statement execute function simulation_tables_frozen();

comment on table stakes is
  'FROZEN (0020): simulated stakes, read-only history. On-chain source of truth = patron_positions / building_pools.';
comment on table stake_payouts is
  'FROZEN (0020): simulated payouts, read-only history.';

-- 4. Fungsi simulasi dihapus ---------------------------------------------------------------------
drop function if exists stake_wage(text, uuid, numeric);
drop function if exists unstake_wage(text, uuid, numeric);

-- 5. Counting House dari chain -------------------------------------------------------------------
-- Counting House = tithe + bagian patron yang dialihkan ke treasury karena bangunan tanpa staker.
-- Di chain:
--   tithe       = Σ JobSplit.titheAmount          (Splitter v1 dan v2: nama event sama, lihat events.ts)
--   redirected  = Σ RewardRedirected.amount       (hanya dipancarkan WageholdPatronage)
-- Semua dalam base unit (18 desimal), dikembalikan sebagai text (numeric(78,0) lewat PostgREST
-- kehilangan presisi di atas 2^53; pola yang sama dengan 0014 / 0018).
-- Hanya event yang SUDAH diindeks. Angka ini tertinggal beberapa menit dari chain.
create or replace function counting_house_totals()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with t as (
    select
      coalesce(sum((args->>'titheAmount')::numeric) filter (where event = 'JobSplit'), 0) as tithe,
      coalesce(sum(amount) filter (where event = 'RewardRedirected'), 0) as redirected
    from chain_events
    where event in ('JobSplit', 'RewardRedirected')
  )
  select jsonb_build_object(
    'tithe',      tithe::text,
    'redirected', redirected::text,
    'total',      (tithe + redirected)::text
  ) from t;
$$;

revoke all on function counting_house_totals() from public, anon, authenticated;
grant execute on function counting_house_totals() to service_role;
