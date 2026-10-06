-- Weighhouse membaca Patronage on-chain -- Dev Brief "On-chain Patronage + Hardening" §8.3 (Tahap 4, sesi 4C).
-- Jalankan setelah 0018. Idempoten. Hanya MENAMBAH / mengganti fungsi baca:
--   * TIDAK menyentuh stakes / stake_payouts / wage_splits / record_wage_split (dibekukan di sesi 4D).
--
-- 1. supply_snapshots.patronage: saldo $WAGE yang dipegang kontrak WageholdPatronage
--    (stake aktif + cooldown + reward belum diklaim). Tanpa kolom ini, token yang sedang di-stake
--    ikut terhitung "Circulating". Baris lama = NULL (dibaca 0: sebelum Patronage tidak ada saldonya).
-- 2. weighhouse_top_buildings.staked: dari building_pools.total_staked (on-chain, via indexer),
--    bukan lagi dari tabel simulasi `stakes`. Tipe kolom berubah numeric -> text (base unit 18 desimal
--    tidak muat di number JSON), jadi fungsi harus di-drop dulu: `create or replace` menolak ganti tipe hasil.

alter table supply_snapshots add column if not exists patronage numeric(78,0);

drop function if exists weighhouse_top_buildings(timestamptz, int);

create function weighhouse_top_buildings(p_since timestamptz default null, p_limit int default 10)
returns table (
  agent_id uuid, name text, code text, district text,
  sealed text, jobs bigint, staked text, rating numeric
)
language sql stable security definer set search_path = public
as $$
  with paid as (
    -- upah yang benar-benar dibayarkan ke payee, per event (sama dengan 0017)
    select e.chain_job_id, e.block_time,
           case e.event
             when 'SealSet' then e.amount
             else (e.args->>'payeeAmount')::numeric
           end as amount
      from chain_events e
     where e.event in ('SealSet', 'DisputeResolved')
       and (p_since is null or e.block_time >= p_since)
  ),
  sealed as (
    select j.agent_id,
           sum(p.amount) as sealed,
           count(distinct j.id) as jobs
      from paid p
      join jobs j on j.chain_job_id = p.chain_job_id
     where j.agent_id is not null
       and coalesce(p.amount, 0) > 0
     group by j.agent_id
  )
  select a.id, a.name, a.code, a.district::text, s.sealed::text, s.jobs,
         -- stake on-chain SEKARANG (bukan jendela waktu). Bangunan yang belum dipetakan / belum punya
         -- pool = 0.
         coalesce((select bp.total_staked from building_pools bp where bp.agent_id = a.chain_agent_id), 0)::text,
         a.rating
    from sealed s
    join agents a on a.id = s.agent_id
   order by s.sealed desc
   limit greatest(p_limit, 1);
$$;

revoke all on function weighhouse_top_buildings(timestamptz, int) from public, anon, authenticated;
grant execute on function weighhouse_top_buildings(timestamptz, int) to service_role;
