-- Weighhouse -- volume pasar dari event on-chain (menggantikan penyebut berbasis snapshot Bitquery).
-- Jalankan setelah 0014. Idempoten.
--
-- Penyebut Work Ratio (brief §4.1) = jumlah ABSOLUT sisi WAGE dari semua trade:
--   CurveBuy  -> tokensOut, CurveSell -> tokensIn   (bonding curve, pra-graduation)
--   Swap      -> |amount sisi WAGE|                 (pool Uniswap v4, pasca-graduation)
-- Semua sudah disimpan sebagai chain_events.amount oleh indexer (lib/weighhouse/indexer.ts).

create or replace function weighhouse_trade_volume(p_since timestamptz default null)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'curve', coalesce(sum(amount) filter (where event in ('CurveBuy', 'CurveSell')), 0)::text,
    'pool',  coalesce(sum(amount) filter (where event = 'Swap'), 0)::text,
    'trades', count(*) filter (where event in ('CurveBuy', 'CurveSell', 'Swap'))
  )
  from chain_events
  where event in ('CurveBuy', 'CurveSell', 'Swap')
    and (p_since is null or block_time >= p_since);
$$;

revoke all on function weighhouse_trade_volume(timestamptz) from public, anon, authenticated;
grant execute on function weighhouse_trade_volume(timestamptz) to service_role;
