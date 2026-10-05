-- Weighhouse: jadwal indexer lewat Supabase (pg_cron + pg_net), menggantikan Vercel Cron (vercel.json dihapus).
-- pg_cron memanggil GET /api/cron/index-chain tiap menit dengan header Authorization: Bearer <CRON_SECRET>.
--
-- SEBELUM / SESUDAH `supabase db push`, isi 2 secret di Vault (SQL Editor, sekali saja; JANGAN taruh di file ini):
--   select vault.create_secret('https://DOMAIN-APP-KAMU.com', 'weighhouse_app_url');
--   select vault.create_secret('<nilai sama dengan CRON_SECRET di env app>', 'weighhouse_cron_secret');
-- Mengubah nilai nanti:
--   select vault.update_secret((select id from vault.secrets where name = 'weighhouse_app_url'), 'https://baru.com');
--
-- Selama secret belum ada, fungsi di bawah hanya mengeluarkan WARNING dan tidak memanggil apa pun.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.weighhouse_call_index_chain()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
  v_req    bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'weighhouse_app_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'weighhouse_cron_secret';

  if v_url is null or v_secret is null then
    raise warning 'weighhouse_call_index_chain: secret weighhouse_app_url / weighhouse_cron_secret belum diisi di Vault';
    return null;
  end if;

  -- timeout 60 dtk = maxDuration route (default pg_net hanya 5 dtk).
  select net.http_get(
           url := rtrim(v_url, '/') || '/api/cron/index-chain',
           headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
           timeout_milliseconds := 60000
         )
    into v_req;

  return v_req;
end;
$$;

revoke all on function public.weighhouse_call_index_chain() from public, anon, authenticated;

-- Idempotent: jadwalkan ulang kalau sudah ada.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'weighhouse-index-chain') then
    perform cron.unschedule('weighhouse-index-chain');
  end if;
  if exists (select 1 from cron.job where jobname = 'weighhouse-cron-cleanup') then
    perform cron.unschedule('weighhouse-cron-cleanup');
  end if;

  perform cron.schedule('weighhouse-index-chain', '* * * * *', 'select public.weighhouse_call_index_chain();');

  -- Riwayat run pg_cron membengkak kalau jalan tiap menit: simpan 3 hari saja.
  perform cron.schedule(
    'weighhouse-cron-cleanup',
    '17 3 * * *',
    $c$delete from cron.job_run_details where end_time < now() - interval '3 days'$c$
  );
end
$$;
