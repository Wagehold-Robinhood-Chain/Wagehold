-- Patronage on-chain -- Dev Brief "On-chain Patronage + Hardening" §7 (Data & backend).
-- Jalankan setelah 0017. Idempoten. Hanya MENAMBAH: tidak menyentuh stakes / stake_payouts /
-- wage_splits / record_wage_split (simulasi dibekukan terpisah, saat cut-over -- lihat
-- PATRONAGE_DATA.md "Yang SENGAJA belum dikerjakan").
--
-- Sumber kebenaran = kontrak. `chain_events` menyimpan event mentah (cron /api/cron/index-chain),
-- lalu patronage_apply() menurunkan `patron_positions` dan `building_pools` dari event itu.
-- Angka live (pending rewards) TIDAK ada di sini: UI membacanya lewat view call kontrak.

-- 1. Pemetaan bangunan: agentId on-chain = keccak256(bytes(uuid)) -- tidak bisa dihitung di SQL
--    (sama dengan jobs.chain_job_id di 0014). Diisi scripts/patronage-backfill-agent-ids.ts.
alter table agents add column if not exists chain_agent_id text unique
  check (chain_agent_id is null or chain_agent_id ~ '^0x[0-9a-f]{64}$');

-- 2. Tabel turunan -------------------------------------------------------------------------------
create table if not exists patron_positions (
  agent_id text not null,          -- bytes32 on-chain (lowercase 0x + 64 hex), BUKAN uuid agents.id
  wallet text not null,            -- lowercase
  staked numeric(78,0) not null default 0 check (staked >= 0),
  cooling numeric(78,0) not null default 0 check (cooling >= 0),
  unlock_at timestamptz,           -- null = tidak ada cooldown berjalan
  claimed_total numeric(78,0) not null default 0 check (claimed_total >= 0),
  updated_block bigint not null,
  primary key (agent_id, wallet)
);
create index if not exists patron_positions_wallet_idx on patron_positions (wallet);

create table if not exists building_pools (
  agent_id text primary key,       -- bytes32 on-chain
  registered boolean not null default false,   -- isBuilding (BuildingRegistered)
  total_staked numeric(78,0) not null default 0 check (total_staked >= 0),
  patron_count int not null default 0 check (patron_count >= 0),   -- posisi dengan staked > 0
  rewards_total numeric(78,0) not null default 0,     -- Σ RewardNotified (dibagi ke patron)
  redirected_total numeric(78,0) not null default 0,  -- Σ RewardRedirected (tanpa staker -> treasury)
  updated_block bigint not null
);

-- Daftar reward per bangunan (GET /api/patronage/pools/:agentId) mencari event berdasarkan args.agentId.
create index if not exists chain_events_agent_idx
  on chain_events ((args->>'agentId'), block_time desc)
  where args->>'agentId' is not null;

-- 3. RLS: baca publik, tulis hanya service role (pola 0005 / 0014) -------------------------------
alter table patron_positions enable row level security;
alter table building_pools enable row level security;

drop policy if exists "patron positions are publicly readable" on patron_positions;
create policy "patron positions are publicly readable" on patron_positions for select using (true);
drop policy if exists "building pools are publicly readable" on building_pools;
create policy "building pools are publicly readable" on building_pools for select using (true);

revoke insert, update, delete, truncate on table public.patron_positions from anon, authenticated;
revoke insert, update, delete, truncate on table public.building_pools from anon, authenticated;

-- 4. patronage_apply: event Patronage di chain_events -> patron_positions / building_pools ---------
-- Dipanggil indexer setelah aliran Patronage selesai menulis event sampai blok p_up_to.
--   * Atomik: satu fungsi = satu transaksi; kalau ada event yang tidak masuk akal (mis. unstake
--     lebih besar dari stake) fungsi RAISE dan cursor TIDAK maju -- gagal keras, bukan angka salah.
--   * Idempoten: cursor `patronage_applied:<alamat>` di indexer_state; blok <= cursor tidak diproses lagi.
--   * Urutan event = (block_number, log_index), sama dengan urutan eksekusi on-chain.
--   * Aman dari dua cron yang tumpang tindih: advisory lock; yang kalah mengembalikan -1.
-- Mengembalikan jumlah event yang diproses (0 = tidak ada yang baru, -1 = sedang dikerjakan proses lain).
create or replace function patronage_apply(p_patronage text, p_up_to bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key     text := 'patronage_applied:' || lower(p_patronage);
  v_from    bigint;
  v_n       integer := 0;
  r         record;
  v_agent   text;
  v_wallet  text;
  v_amt     numeric;
  v_staked  numeric;
  v_cooling numeric;
begin
  if not pg_try_advisory_xact_lock(hashtext(v_key)) then
    return -1;
  end if;

  select last_block into v_from from indexer_state where key = v_key;
  v_from := coalesce(v_from, -1);
  if p_up_to <= v_from then
    return 0;
  end if;

  for r in
    select e.block_number, e.log_index, e.event, e.amount, e.args
      from chain_events e
     where e.contract = lower(p_patronage)
       and e.block_number > v_from
       and e.block_number <= p_up_to
       and e.event in ('Staked', 'UnstakeRequested', 'Withdrawn', 'Claimed',
                       'RewardNotified', 'RewardRedirected', 'BuildingRegistered')
     order by e.block_number, e.log_index
  loop
    v_agent := lower(r.args->>'agentId');
    v_amt   := coalesce(r.amount, 0);

    insert into building_pools (agent_id, updated_block)
    values (v_agent, r.block_number)
    on conflict (agent_id) do nothing;

    if r.event = 'BuildingRegistered' then
      update building_pools
         set registered = (r.args->>'on')::boolean, updated_block = r.block_number
       where agent_id = v_agent;

    elsif r.event = 'RewardNotified' then
      update building_pools
         set rewards_total = rewards_total + v_amt, updated_block = r.block_number
       where agent_id = v_agent;

    elsif r.event = 'RewardRedirected' then
      update building_pools
         set redirected_total = redirected_total + v_amt, updated_block = r.block_number
       where agent_id = v_agent;

    else
      v_wallet := lower(r.args->>'user');

      insert into patron_positions (agent_id, wallet, updated_block)
      values (v_agent, v_wallet, r.block_number)
      on conflict (agent_id, wallet) do nothing;

      select staked, cooling into v_staked, v_cooling
        from patron_positions where agent_id = v_agent and wallet = v_wallet;

      if r.event = 'Staked' then
        update patron_positions
           set staked = staked + v_amt, updated_block = r.block_number
         where agent_id = v_agent and wallet = v_wallet;
        update building_pools
           set total_staked = total_staked + v_amt,
               patron_count = patron_count + (case when v_staked = 0 then 1 else 0 end),
               updated_block = r.block_number
         where agent_id = v_agent;

      elsif r.event = 'UnstakeRequested' then
        if v_amt > v_staked then
          raise exception 'patronage_apply: UnstakeRequested % exceeds staked % (agent %, wallet %, block %, log %)',
            v_amt, v_staked, v_agent, v_wallet, r.block_number, r.log_index;
        end if;
        update patron_positions
           set staked = staked - v_amt,
               cooling = cooling + v_amt,
               unlock_at = to_timestamp((r.args->>'unlockAt')::numeric),
               updated_block = r.block_number
         where agent_id = v_agent and wallet = v_wallet;
        update building_pools
           set total_staked = total_staked - v_amt,
               patron_count = patron_count - (case when v_staked - v_amt = 0 then 1 else 0 end),
               updated_block = r.block_number
         where agent_id = v_agent;

      elsif r.event = 'Withdrawn' then
        if v_amt > v_cooling then
          raise exception 'patronage_apply: Withdrawn % exceeds cooling % (agent %, wallet %, block %, log %)',
            v_amt, v_cooling, v_agent, v_wallet, r.block_number, r.log_index;
        end if;
        update patron_positions
           set cooling = cooling - v_amt,
               unlock_at = case when cooling - v_amt = 0 then null else unlock_at end,
               updated_block = r.block_number
         where agent_id = v_agent and wallet = v_wallet;

      elsif r.event = 'Claimed' then
        update patron_positions
           set claimed_total = claimed_total + v_amt, updated_block = r.block_number
         where agent_id = v_agent and wallet = v_wallet;
      end if;
    end if;

    v_n := v_n + 1;
  end loop;

  insert into indexer_state (key, last_block) values (v_key, p_up_to)
  on conflict (key) do update set last_block = excluded.last_block;

  return v_n;
end $$;

-- 5. Fungsi baca (service role; semua jumlah dikembalikan sebagai text, lihat catatan presisi) ------
-- numeric(78,0) lewat PostgREST menjadi angka JSON -> kehilangan presisi di atas 2^53 (stake 18
-- desimal sudah melewatinya). Pola yang sama dengan weighhouse_flow (0014).

-- Semua bangunan yang terdaftar (atau punya stake) + angka jendela waktu. p_since null = semua waktu.
--   sealed_window      upah tersegel (SealSet + bagian payee DisputeResolved), sama dengan 0017
--   patron_cut_window  Σ JobSplit.patronAmount (hanya Splitter v2: v1 tidak punya agentId)
--   notified_window    Σ RewardNotified (yang benar-benar dibagi ke patron; cut tanpa staker tidak masuk)
create or replace function patronage_pools(p_since timestamptz default null)
returns table (
  agent_id uuid, chain_agent_id text, name text, code text, district text,
  registered boolean, total_staked text, patron_count int,
  rewards_total text, redirected_total text,
  sealed_window text, jobs_window bigint, patron_cut_window text, notified_window text
)
language sql stable security definer set search_path = public
as $$
  with paid as (
    select e.chain_job_id,
           case e.event when 'SealSet' then e.amount else (e.args->>'payeeAmount')::numeric end as amount
      from chain_events e
     where e.event in ('SealSet', 'DisputeResolved')
       and (p_since is null or e.block_time >= p_since)
  ),
  sealed as (
    select j.agent_id, sum(p.amount) as sealed, count(distinct j.id) as jobs
      from paid p
      join jobs j on j.chain_job_id = p.chain_job_id
     where j.agent_id is not null and coalesce(p.amount, 0) > 0
     group by j.agent_id
  ),
  per_agent as (
    select e.args->>'agentId' as cid,
           sum((e.args->>'patronAmount')::numeric) filter (where e.event = 'JobSplit') as cut,
           sum(e.amount) filter (where e.event = 'RewardNotified') as notified
      from chain_events e
     where e.event in ('JobSplit', 'RewardNotified')
       and e.args->>'agentId' is not null
       and (p_since is null or e.block_time >= p_since)
     group by 1
  )
  select a.id, a.chain_agent_id, a.name, a.code, a.district::text,
         coalesce(bp.registered, false),
         coalesce(bp.total_staked, 0)::text,
         coalesce(bp.patron_count, 0),
         coalesce(bp.rewards_total, 0)::text,
         coalesce(bp.redirected_total, 0)::text,
         coalesce(s.sealed, 0)::text,
         coalesce(s.jobs, 0),
         coalesce(pa.cut, 0)::text,
         coalesce(pa.notified, 0)::text
    from agents a
    join building_pools bp on bp.agent_id = a.chain_agent_id
    left join sealed s on s.agent_id = a.id
    left join per_agent pa on pa.cid = a.chain_agent_id
   where a.chain_agent_id is not null
     and (bp.registered or bp.total_staked > 0);
$$;

-- Posisi satu wallet di semua bangunan. LEFT JOIN: posisi di bangunan yang belum dipetakan
-- (agents.chain_agent_id kosong) tetap muncul, dengan name null, bukan menghilang diam-diam.
create or replace function patronage_positions_of(p_wallet text)
returns table (
  chain_agent_id text, agent_id uuid, name text, code text, district text,
  staked text, cooling text, unlock_at timestamptz, claimed_total text, updated_block bigint
)
language sql stable security definer set search_path = public
as $$
  select pp.agent_id, a.id, a.name, a.code, a.district::text,
         pp.staked::text, pp.cooling::text, pp.unlock_at, pp.claimed_total::text, pp.updated_block
    from patron_positions pp
    left join agents a on a.chain_agent_id = pp.agent_id
   where pp.wallet = lower(p_wallet)
     and (pp.staked > 0 or pp.cooling > 0 or pp.claimed_total > 0)
   order by pp.staked desc, pp.updated_block desc;
$$;

-- Reward terbaru satu bangunan, dengan tautan ke job (jobs.chain_job_id). kind: 'shared' | 'redirected'.
create or replace function patronage_pool_rewards(p_chain_agent_id text, p_limit int default 20)
returns table (
  tx_hash text, log_index int, block_number bigint, block_time timestamptz,
  kind text, amount text, chain_job_id text, job_id uuid
)
language sql stable security definer set search_path = public
as $$
  select e.tx_hash, e.log_index, e.block_number, e.block_time,
         case e.event when 'RewardNotified' then 'shared' else 'redirected' end,
         e.amount::text, e.chain_job_id, j.id
    from chain_events e
    left join jobs j on j.chain_job_id = e.chain_job_id
   where e.event in ('RewardNotified', 'RewardRedirected')
     and e.args->>'agentId' = lower(p_chain_agent_id)
   order by e.block_time desc, e.log_index desc
   limit least(greatest(p_limit, 1), 100);
$$;

-- Total semua bangunan -- sumber "Staked by patrons" / "Patron rewards paid" Weighhouse (Tahap 4).
create or replace function patronage_totals()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'totalStaked',     coalesce(sum(total_staked), 0)::text,
    'rewardsTotal',    coalesce(sum(rewards_total), 0)::text,
    'redirectedTotal', coalesce(sum(redirected_total), 0)::text,
    'buildings',       count(*) filter (where registered),
    'patrons',         (select count(distinct wallet) from patron_positions where staked > 0)
  )
  from building_pools;
$$;

revoke all on function patronage_apply(text, bigint) from public, anon, authenticated;
revoke all on function patronage_pools(timestamptz) from public, anon, authenticated;
revoke all on function patronage_positions_of(text) from public, anon, authenticated;
revoke all on function patronage_pool_rewards(text, int) from public, anon, authenticated;
revoke all on function patronage_totals() from public, anon, authenticated;
grant execute on function patronage_apply(text, bigint) to service_role;
grant execute on function patronage_pools(timestamptz) to service_role;
grant execute on function patronage_positions_of(text) to service_role;
grant execute on function patronage_pool_rewards(text, int) to service_role;
grant execute on function patronage_totals() to service_role;
