-- Weighhouse: perapihan setelah 0014-0016.
--  (B.5) "Sealed" di Top buildings disamakan dengan Work Ratio / flow: SealSet + bagian payee DisputeResolved.
--  (B.6) drop weighhouse_swap_volume (tidak dipakai; penyebut Work Ratio dari weighhouse_trade_volume, 0015).
--  (B.7) retensi snapshot lewat pg_cron: supply 30 hari, harga 180 hari (halaman hanya membaca
--        snapshot supply TERBARU dan grafik harga maksimal 30 hari).
-- Aman dijalankan ulang.

-- B.5 ------------------------------------------------------------------------------------------
create or replace function weighhouse_top_buildings(p_since timestamptz default null, p_limit int default 10)
returns table (
  agent_id uuid, name text, code text, district text,
  sealed text, jobs bigint, staked numeric, rating numeric
)
language sql stable security definer set search_path = public
as $$
  with paid as (
    -- upah yang benar-benar dibayarkan ke payee, per event
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
         coalesce((select sum(st.amount) from stakes st where st.agent_id = a.id), 0),
         a.rating
    from sealed s
    join agents a on a.id = s.agent_id
   order by s.sealed desc
   limit greatest(p_limit, 1);
$$;

revoke all on function weighhouse_top_buildings(timestamptz, int) from public, anon, authenticated;
grant execute on function weighhouse_top_buildings(timestamptz, int) to service_role;

-- B.6 ------------------------------------------------------------------------------------------
drop function if exists weighhouse_swap_volume(timestamptz);

-- B.7 ------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'weighhouse-snapshot-retention') then
    perform cron.unschedule('weighhouse-snapshot-retention');
  end if;
  perform cron.schedule(
    'weighhouse-snapshot-retention',
    '23 3 * * *',
    $c$
      delete from public.supply_snapshots where taken_at < now() - interval '30 days';
      delete from public.price_snapshots  where taken_at < now() - interval '180 days';
    $c$
  );
end
$$;
