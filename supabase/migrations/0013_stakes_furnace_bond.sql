-- Revision 1 (langkah 3): Patronage (stake $WAGE per bangunan), Furnace (burn) dan Bond.
-- Jalankan setelah 0012. Idempoten (aman diulang). MODE SIMULASI: tidak ada token
-- yang bergerak -- stake hanya catatan di Postgres (staking on-chain belum ada).
--
--   agents.bond_wage   WAGE yang dikunci bangunan itu (slashed kalau kalah sengketa).
--                      NILAI AWAL 1000 ADALAH PLACEHOLDER -- ubah per bangunan di
--                      Table Editor kalau lore punya angka sendiri.
--   stakes             stake tiap patron pada satu bangunan (+ total `earned`).
--   stake_payouts      bagian patron dari SATU job yang disegel, per staker.
--   wage_splits        catatan pembagian 60/20/10/10 untuk SATU job yang disegel
--                      (sumber angka Furnace dan Counting House).
--   record_wage_split  fungsi atomik yang dipanggil approveJob() setelah seal.
--   stake_wage / unstake_wage  fungsi atomik untuk POST/DELETE /api/agents/:id/stake.

-- Bond -----------------------------------------------------------------
alter table agents add column if not exists bond_wage numeric not null default 1000
  check (bond_wage >= 0);

-- Stakes ---------------------------------------------------------------
create table if not exists stakes (
  id uuid primary key default gen_random_uuid(),
  -- sama dengan jobs.client_id: `sim:<hash>` (mode simulasi) atau alamat wallet lowercase
  staker_id text not null,
  agent_id uuid not null references agents (id) on delete cascade,
  -- 0 = sudah menarik semua stake tapi barisnya dipertahankan (riwayat `earned`)
  amount numeric not null default 0 check (amount >= 0),
  earned numeric not null default 0 check (earned >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staker_id, agent_id)
);
create index if not exists stakes_agent_idx on stakes (agent_id);

create table if not exists stake_payouts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  staker_id text not null,
  amount numeric not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (job_id, staker_id)
);
create index if not exists stake_payouts_staker_idx on stake_payouts (staker_id, created_at desc);

create table if not exists wage_splits (
  job_id uuid primary key references jobs (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  gross numeric not null,
  patrons numeric not null,      -- bagian patron (sebelum dibagi ke staker)
  lamp_oil numeric not null,
  tithe numeric not null,
  furnace numeric not null,      -- dibakar
  -- bagian patron yang tidak terbagi (bangunan tanpa staker, atau sisa pembulatan)
  -- masuk treasury. Counting House = sum(tithe + treasury_redirect).
  treasury_redirect numeric not null default 0,
  staker_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- RLS: baca publik, tulis hanya lewat service role / fungsi di bawah -------------
alter table stakes enable row level security;
alter table stake_payouts enable row level security;
alter table wage_splits enable row level security;

drop policy if exists "stakes are publicly readable" on stakes;
create policy "stakes are publicly readable" on stakes for select using (true);
drop policy if exists "stake payouts are publicly readable" on stake_payouts;
create policy "stake payouts are publicly readable" on stake_payouts for select using (true);
drop policy if exists "wage splits are publicly readable" on wage_splits;
create policy "wage splits are publicly readable" on wage_splits for select using (true);

revoke insert, update, delete, truncate on table public.stakes from anon, authenticated;
revoke insert, update, delete, truncate on table public.stake_payouts from anon, authenticated;
revoke insert, update, delete, truncate on table public.wage_splits from anon, authenticated;

-- Fungsi -----------------------------------------------------------------

-- Tambah stake (atomik). Mengembalikan stake terbaru.
create or replace function stake_wage(p_staker text, p_agent uuid, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_amount numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than 0';
  end if;
  insert into stakes (staker_id, agent_id, amount)
  values (p_staker, p_agent, p_amount)
  on conflict (staker_id, agent_id)
  do update set amount = stakes.amount + excluded.amount, updated_at = now()
  returning amount into new_amount;
  return new_amount;
end $$;

-- Tarik stake (atomik). Melempar 'insufficient stake' kalau melebihi stake sekarang.
create or replace function unstake_wage(p_staker text, p_agent uuid, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_amount numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than 0';
  end if;
  update stakes
     set amount = amount - p_amount, updated_at = now()
   where staker_id = p_staker and agent_id = p_agent and amount >= p_amount
  returning amount into new_amount;
  if new_amount is null then
    raise exception 'insufficient stake';
  end if;
  return new_amount;
end $$;

-- Catat pembagian satu job yang sudah 'paid'. Idempoten: kalau job itu sudah punya
-- baris wage_splits, tidak melakukan apa pun dan mengembalikan null.
-- Persentase dikirim dari aplikasi (WAGE_SPLIT di lib/currency.ts) supaya hanya ada
-- satu sumber kebenaran; fungsi ini hanya memastikan totalnya 100.
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
  total_staked numeric;
  distributed numeric := 0;
  n_stakers integer := 0;
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

  select coalesce(sum(amount), 0), count(*) into total_staked, n_stakers
    from stakes where agent_id = j.agent_id and amount > 0;

  if total_staked > 0 then
    insert into stake_payouts (job_id, agent_id, staker_id, amount)
    select p_job_id, agent_id, staker_id, trunc(patrons * amount / total_staked, 6)
      from stakes
     where agent_id = j.agent_id and amount > 0;

    update stakes s
       set earned = s.earned + p.amount, updated_at = now()
      from stake_payouts p
     where p.job_id = p_job_id and p.agent_id = s.agent_id and p.staker_id = s.staker_id;

    select coalesce(sum(amount), 0) into distributed
      from stake_payouts where job_id = p_job_id;
  end if;

  insert into wage_splits (job_id, agent_id, gross, patrons, lamp_oil, tithe, furnace, treasury_redirect, staker_count)
  values (p_job_id, j.agent_id, gross, patrons, lamp, tithe, furnace, patrons - distributed, n_stakers);

  return jsonb_build_object(
    'gross', gross,
    'patrons', patrons,
    'lampOil', lamp,
    'tithe', tithe,
    'furnace', furnace,
    'distributed', distributed,
    'treasuryRedirect', patrons - distributed,
    'stakerCount', n_stakers
  );
end $$;

-- Hanya service role yang boleh memanggil (browser tidak boleh mengarang stake / split).
revoke all on function stake_wage(text, uuid, numeric) from public, anon, authenticated;
revoke all on function unstake_wage(text, uuid, numeric) from public, anon, authenticated;
revoke all on function record_wage_split(uuid, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function stake_wage(text, uuid, numeric) to service_role;
grant execute on function unstake_wage(text, uuid, numeric) to service_role;
grant execute on function record_wage_split(uuid, numeric, numeric, numeric, numeric) to service_role;

-- Backfill: job 'paid' yang sudah ada dihitung ulang dengan split 60/20/10/10.
-- Belum ada staker, jadi bagian patron-nya masuk treasury (Counting House).
-- Job tes (B4) ikut terhitung sampai kamu menghapusnya -- hapus barisnya di `jobs`
-- (wage_splits ikut terhapus lewat on delete cascade).
select record_wage_split(id, 60, 20, 10, 10)
  from jobs
 where status = 'paid' and agent_id is not null
   and not exists (select 1 from wage_splits w where w.job_id = jobs.id);

-- Realtime: stakes, stake_payouts, wage_splits -----------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['stakes', 'stake_payouts', 'wage_splits'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
