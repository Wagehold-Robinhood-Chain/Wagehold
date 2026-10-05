-- The Weighhouse ($WAGE Monitor) -- Dev Brief v1.0 §5.4.
-- Jalankan setelah 0013. Idempoten. Semua tabel BACA-PUBLIK, tulis hanya lewat service role
-- (pola 0005_harden_rls.sql): cron /api/cron/index-chain yang menulis.

-- Event on-chain (Strongbox, Splitter, dan -- kalau pool dikonfigurasi -- Swap Uniswap v4) -----
create table if not exists chain_events (
  tx_hash text not null,
  log_index int not null,
  block_number bigint not null,
  block_time timestamptz not null,
  contract text not null,
  event text not null,
  chain_job_id text,
  -- jumlah utama event dalam base unit (18 desimal). Lihat lib/weighhouse/events.ts untuk
  -- definisi per event (mis. JobSplit = jumlah 4 bagian, DisputeResolved = payee + refund,
  -- Swap = sisi WAGE absolut).
  amount numeric(78,0),
  args jsonb not null,
  primary key (tx_hash, log_index)
);
create index if not exists chain_events_event_time_idx on chain_events (event, block_time desc);
create index if not exists chain_events_job_idx on chain_events (chain_job_id) where chain_job_id is not null;
create index if not exists chain_events_time_idx on chain_events (block_time desc);

create table if not exists price_snapshots (
  taken_at timestamptz primary key,
  price_usd numeric,
  price_eth numeric,
  liquidity_usd numeric,
  volume_wage numeric(78,0),
  source text not null
);

create table if not exists supply_snapshots (
  taken_at timestamptz primary key,
  block_number bigint not null,
  total numeric(78,0),
  burned numeric(78,0),
  curve numeric(78,0),
  lp numeric(78,0),         -- null = pool belum dikonfigurasi/tidak terlacak (bukan 0)
  locker numeric(78,0),
  strongbox numeric(78,0),
  splitter numeric(78,0),
  treasuries numeric(78,0),
  circulating numeric(78,0)
);

create table if not exists indexer_state (
  key text primary key,
  last_block bigint not null
);

-- Pemetaan job: jobId on-chain = keccak256(bytes(uuid)) -- dihitung di app (tidak bisa di SQL).
alter table jobs add column if not exists chain_job_id text unique;

-- RLS -------------------------------------------------------------------------------------
alter table chain_events enable row level security;
alter table price_snapshots enable row level security;
alter table supply_snapshots enable row level security;
alter table indexer_state enable row level security;

drop policy if exists "chain events are publicly readable" on chain_events;
create policy "chain events are publicly readable" on chain_events for select using (true);
drop policy if exists "price snapshots are publicly readable" on price_snapshots;
create policy "price snapshots are publicly readable" on price_snapshots for select using (true);
drop policy if exists "supply snapshots are publicly readable" on supply_snapshots;
create policy "supply snapshots are publicly readable" on supply_snapshots for select using (true);
-- indexer_state: tanpa policy SELECT -> hanya service role.

revoke insert, update, delete, truncate on table public.chain_events from anon, authenticated;
revoke insert, update, delete, truncate on table public.price_snapshots from anon, authenticated;
revoke insert, update, delete, truncate on table public.supply_snapshots from anon, authenticated;
revoke all on table public.indexer_state from anon, authenticated;

-- Agregasi (service role saja) ----------------------------------------------------------------
-- p_since null = semua waktu. Semua jumlah dikembalikan sebagai string (numeric 78 digit tidak
-- muat di number JS).

create or replace function weighhouse_flow(p_since timestamptz default null)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'locked',        coalesce(sum(amount) filter (where event = 'JobFunded'), 0)::text,
    -- Sealed = SealSet + bagian payee dari DisputeResolved (upah yang benar-benar dibayarkan).
    'sealed',        (coalesce(sum(amount) filter (where event = 'SealSet'), 0)
                      + coalesce(sum((args->>'payeeAmount')::numeric) filter (where event = 'DisputeResolved'), 0))::text,
    'refunded',      (coalesce(sum(amount) filter (where event = 'JobRefunded'), 0)
                      + coalesce(sum((args->>'refundAmount')::numeric) filter (where event = 'DisputeResolved'), 0))::text,
    'patrons',       coalesce(sum((args->>'patronAmount')::numeric)  filter (where event = 'JobSplit'), 0)::text,
    'lampOil',       coalesce(sum((args->>'lampOilAmount')::numeric) filter (where event = 'JobSplit'), 0)::text,
    'tithe',         coalesce(sum((args->>'titheAmount')::numeric)   filter (where event = 'JobSplit'), 0)::text,
    'furnaceBooked', coalesce(sum((args->>'burnAmount')::numeric)    filter (where event = 'JobSplit'), 0)::text,
    'burned',        coalesce(sum(amount) filter (where event = 'Burned'), 0)::text,
    'jobsPosted',    count(*) filter (where event = 'JobFunded'),
    'jobsSealed',    count(*) filter (where event = 'SealSet'),
    'jobsRefunded',  count(*) filter (where event = 'JobRefunded'),
    'jobsDisputed',  count(*) filter (where event = 'SealBroken')
  )
  from chain_events
  where p_since is null or block_time >= p_since;
$$;

-- Volume trading WAGE (penyebut Work Ratio): jumlah absolut sisi WAGE semua event Swap.
create or replace function weighhouse_swap_volume(p_since timestamptz default null)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(amount), 0)::text from chain_events
  where event = 'Swap' and (p_since is null or block_time >= p_since);
$$;

create or replace function weighhouse_burn_daily(p_since timestamptz default null)
returns table (day date, burned text)
language sql stable security definer set search_path = public
as $$
  select (block_time at time zone 'UTC')::date as day, sum(amount)::text as burned
  from chain_events
  where event = 'Burned' and (p_since is null or block_time >= p_since)
  group by 1 order by 1;
$$;

-- Top bangunan: upah tersegel per agent_id, lewat jobs.chain_job_id.
create or replace function weighhouse_top_buildings(p_since timestamptz default null, p_limit int default 10)
returns table (
  agent_id uuid, name text, code text, district text,
  sealed text, jobs bigint, staked numeric, rating numeric
)
language sql stable security definer set search_path = public
as $$
  with sealed as (
    select j.agent_id,
           sum(e.amount) as sealed,
           count(*) as jobs
      from chain_events e
      join jobs j on j.chain_job_id = e.chain_job_id
     where e.event = 'SealSet'
       and j.agent_id is not null
       and (p_since is null or e.block_time >= p_since)
     group by j.agent_id
  )
  select a.id, a.name, a.code, a.district::text, s.sealed::text, s.jobs,
         coalesce((select sum(st.amount) from stakes st where st.agent_id = a.id), 0),
         a.rating
    from sealed s
    join agents a on a.id = s.agent_id
   order by s.sealed desc
   limit greatest(p_limit, 1);
$$;

revoke all on function weighhouse_flow(timestamptz) from public, anon, authenticated;
revoke all on function weighhouse_swap_volume(timestamptz) from public, anon, authenticated;
revoke all on function weighhouse_burn_daily(timestamptz) from public, anon, authenticated;
revoke all on function weighhouse_top_buildings(timestamptz, int) from public, anon, authenticated;
grant execute on function weighhouse_flow(timestamptz) to service_role;
grant execute on function weighhouse_swap_volume(timestamptz) to service_role;
grant execute on function weighhouse_burn_daily(timestamptz) to service_role;
grant execute on function weighhouse_top_buildings(timestamptz, int) to service_role;

-- Realtime: ledger + counter hidup (useRealtimeChanges('chain_events')) -----------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chain_events'
  ) then
    alter publication supabase_realtime add table chain_events;
  end if;
end $$;
