import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  ADDRESSES,
  OPEN_ITEMS,
  PATRONAGE,
  PONS,
  WAGE_TOTAL_SUPPLY_CAP,
} from '@/lib/web3/addresses';
import { EVENT_KIND, LEDGER_EVENT_NAMES } from './events';

export type Win = '24h' | '7d' | 'all';
export const parseWindow = (v: string | null): Win =>
  v === '24h' || v === 'all' ? v : '7d';
const WINDOW_MS: Record<Exclude<Win, 'all'>, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
};
export const sinceFor = (w: Win): string | null =>
  w === 'all' ? null : new Date(Date.now() - WINDOW_MS[w]).toISOString();

const big = (v: unknown): bigint => {
  if (v === null || v === undefined) return 0n;
  const str = String(v);
  return /^-?\d+$/.test(str)
    ? BigInt(str)
    : BigInt(Math.trunc(Number(str)) || 0);
};
/** base unit (18 desimal) -> number WAGE (cukup untuk tampilan; verifikasi lewat Blockscout). */
export const wageNum = (
  v: bigint | string | number | null | undefined,
): number => {
  const b = big(v);
  const whole = b / 10n ** 18n;
  const frac = Number(b % 10n ** 18n) / 1e18;
  return Number(whole) + frac;
};

export interface BucketLink {
  label: string;
  address: string;
}
export interface SupplyBucket {
  key: string;
  label: string;
  plain: string;
  amount: number;
  pct: number;
  links?: BucketLink[];
  note?: string;
}

/** Total Patronage semua bangunan, SEMUA WAKTU (bukan jendela `window`), satuan WAGE utuh. */
export interface PatronageSummary {
  /** WEIGHHOUSE_PATRONAGE_ADDRESS terisi. false = kartu menampilkan "belum live", bukan angka 0. */
  configured: boolean;
  /** Total terbaca dari indexer. false (dengan configured true) = indexer/DB belum siap. */
  ok: boolean;
  /** Stake aktif sekarang (turunan event Staked/UnstakeRequested). */
  stakedWage: number;
  /** Σ reward yang benar-benar dibagi ke patron (RewardNotified). */
  rewardsPaidWage: number;
  /** Σ reward yang dialihkan ke treasury karena tidak ada staker (RewardRedirected). */
  redirectedWage: number;
  /** Wallet berbeda dengan stake > 0. */
  patrons: number;
  /** Bangunan terdaftar. */
  buildings: number;
}

export interface Summary {
  window: Win;
  generatedAt: string;
  /** Waktu graduation (event PoolGraduated yang terindeks); null = belum / tidak terindeks. */
  graduatedAt: string | null;
  tiles: {
    priceUsd: number | null;
    priceEth: number | null;
    change24hPct: number | null;
    marketCapUsd: number | null;
    liquidityUsd: number | null;
    priceSource: string | null;
    priceUpdatedAt: string | null;
    priceStale: boolean;
    workRatioPct: number | null;
    workRatioCapped: boolean;
    sealedWage: number;
    tradedWage: number;
    tradeVolumeSource: 'on-chain' | 'none';
    tradeVolume: { curveWage: number; poolWage: number; trades: number };
  };
  /** Patronage on-chain (Dev Brief §8.3): total stake dan reward patron dari indexer (building_pools, 0018). */
  patronage: PatronageSummary;
  supply: {
    updatedAt: string | null;
    blockNumber: number | null;
    total: number;
    buckets: SupplyBucket[];
    lpTracked: boolean;
    sumGapWage: number | null;
  } | null;
  flow: {
    locked: number;
    sealed: number;
    patrons: number;
    lampOil: number;
    tithe: number;
    furnace: number;
    stillInEscrow: number;
    refunded: number;
    jobs: {
      posted: number;
      sealed: number;
      refunded: number;
      disputed: number;
    };
    splitSource: 'events';
  };
  furnace: {
    burnedAllTime: number;
    burnedInWindow: number;
    pctOfSupply: number;
    booked: number;
    daily: { day: string; burned: number; cumulative: number }[];
    latest: { txHash: string; at: string; amount: number }[];
  };
  indexer: { lastBlock: number | null };
}

/** Total Patronage on-chain dari `patronage_totals()` (0018): stake aktif, reward yang dibagi, reward yang dialihkan.
 *  Data berasal dari indexer, jadi tertinggal beberapa menit. */
async function readPatronageSummary(
  db: ReturnType<typeof createServiceRoleClient>,
): Promise<PatronageSummary> {
  const off: PatronageSummary = {
    configured: !!PATRONAGE.patronage,
    ok: false,
    stakedWage: 0,
    rewardsPaidWage: 0,
    redirectedWage: 0,
    patrons: 0,
    buildings: 0,
  };
  if (!PATRONAGE.patronage) return off;
  const { data, error } = await db.rpc('patronage_totals');
  if (error || !data) return off;
  return {
    configured: true,
    ok: true,
    stakedWage: wageNum(data.totalStaked),
    rewardsPaidWage: wageNum(data.rewardsTotal),
    redirectedWage: wageNum(data.redirectedTotal),
    patrons: Number(data.patrons) || 0,
    buildings: Number(data.buildings) || 0,
  };
}

export async function getSummary(win: Win): Promise<Summary> {
  const db = createServiceRoleClient();
  const since = sinceFor(win);
  const now = Date.now();

  const [
    flowRes,
    volRes,
    supplyRes,
    priceRes,
    price24Res,
    burnsRes,
    dailyRes,
    allBurnRes,
    gradRes,
    stateRes,
    patronage,
  ] = await Promise.all([
    db.rpc('weighhouse_flow', { p_since: since }),
    db.rpc('weighhouse_trade_volume', { p_since: since }),
    db
      .from('supply_snapshots')
      .select('*')
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('price_snapshots')
      .select('*')
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('price_snapshots')
      .select('price_usd,price_eth,taken_at')
      .lte('taken_at', new Date(now - 86_400_000).toISOString())
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('chain_events')
      .select('tx_hash,block_time,amount')
      .eq('event', 'Burned')
      .order('block_time', { ascending: false })
      .limit(10),
    db.rpc('weighhouse_burn_daily', { p_since: since }),
    db.rpc('weighhouse_burn_daily', { p_since: null }),
    db
      .from('chain_events')
      .select('block_time')
      .eq('event', 'PoolGraduated')
      .order('block_time', { ascending: true })
      .limit(1)
      .maybeSingle(),
    db
      .from('indexer_state')
      .select('last_block')
      .eq('key', 'chain_events')
      .maybeSingle(),
    readPatronageSummary(db).catch(
      (): PatronageSummary => ({
        configured: !!PATRONAGE.patronage,
        ok: false,
        stakedWage: 0,
        rewardsPaidWage: 0,
        redirectedWage: 0,
        patrons: 0,
        buildings: 0,
      }),
    ),
  ]);

  const f = flowRes.data;
  const sealed = big(f?.sealed),
    locked = big(f?.locked),
    refunded = big(f?.refunded);

  // ---- Work Ratio (§4.1): sealed / trading volume (WAGE, jendela sama) --------------------
  // Penyebut = curve (CurveBuy/CurveSell) + pool v4 (Swap), semuanya event on-chain (migrasi 0015).
  const tv = (volRes.data ?? {}) as {
    curve?: string;
    pool?: string;
    trades?: number;
  };
  const curveVol = big(tv.curve),
    poolVol = big(tv.pool);
  const vol = curveVol + poolVol;
  const tradeVolumeSource = vol > 0n ? 'on-chain' : 'none';
  let workRatioPct: number | null = null;
  let workRatioCapped = false;
  if (vol > 0n) {
    const pct = Number((sealed * 100_000n) / vol) / 1000; // 3 desimal
    workRatioCapped = pct > 999;
    workRatioPct = Math.min(pct, 999);
  }

  // ---- Supply (§4B) ------------------------------------------------------------------------
  const sp = supplyRes.data;
  let supply: Summary['supply'] = null;
  if (sp) {
    const total = big(sp.total);
    const pct = (b: bigint) =>
      total > 0n ? Number((b * 100_000n) / total) / 1000 : 0;
    const mk = (
      key: string,
      label: string,
      plain: string,
      b: bigint | null,
      links?: BucketLink[],
      note?: string,
    ): SupplyBucket => ({
      key,
      label,
      plain,
      amount: wageNum(b ?? 0n),
      pct: pct(b ?? 0n),
      links,
      note,
    });
    const buckets: SupplyBucket[] = [
      mk('burned', 'Furnace', 'burned', big(sp.burned), [
        { label: 'Furnace (dEaD)', address: ADDRESSES.furnace },
      ]),
      mk(
        'curve',
        'Bonding curve',
        'pre-graduation',
        big(sp.curve),
        OPEN_ITEMS.wageCurve
          ? [{ label: 'Bonding curve', address: OPEN_ITEMS.wageCurve }]
          : undefined,
      ),
      mk(
        'lp',
        'LP pool',
        'post-graduation',
        sp.lp == null ? 0n : big(sp.lp),
        [{ label: 'Uniswap v4 PoolManager', address: PONS.poolManager }],
        sp.lp == null
          ? 'Not tracked yet'
          : big(sp.lp) > 0n
            ? 'Estimated (full-range pool)'
            : undefined,
      ),
      mk('locker', 'Pons locker', 'locked', big(sp.locker), [
        { label: 'Pons locker', address: PONS.launchLocker },
      ]),
      // v1 + v2 dijumlah di satu bucket (supply.ts); tautan Blockscout memuat keduanya.
      mk('strongbox', 'Strongbox', 'escrow', big(sp.strongbox), [
        { label: 'Strongbox', address: ADDRESSES.strongbox },
        ...(PATRONAGE.strongboxV2
          ? [{ label: 'Strongbox v2', address: PATRONAGE.strongboxV2 }]
          : []),
      ]),
      mk('splitter', 'Splitter', 'pending split / burn', big(sp.splitter), [
        { label: 'Splitter', address: ADDRESSES.splitter },
        ...(PATRONAGE.splitterV2
          ? [{ label: 'Splitter v2', address: PATRONAGE.splitterV2 }]
          : []),
      ]),
      // Saldo kontrak Patronage: stake aktif + cooldown + reward belum diklaim (snapshot lama: kolom NULL = 0).
      mk(
        'patronage',
        'Patronage',
        'staked + unclaimed rewards',
        big(sp.patronage),
        PATRONAGE.patronage
          ? [{ label: 'Patronage', address: PATRONAGE.patronage }]
          : undefined,
      ),
      mk('treasuries', 'Treasuries', 'Lamp Oil + Tithe', big(sp.treasuries), [
        { label: 'Lamp Oil', address: ADDRESSES.lampOilTreasury },
        { label: 'Tithe', address: ADDRESSES.titheTreasury },
      ]),
      mk('circulating', 'Circulating', 'everything else', big(sp.circulating)),
    ];
    const sum = [
      sp.burned,
      sp.curve,
      sp.lp,
      sp.locker,
      sp.strongbox,
      sp.splitter,
      sp.patronage,
      sp.treasuries,
      sp.circulating,
    ].reduce<bigint>((a, v) => a + big(v), 0n);
    const gap = total - sum;
    supply = {
      updatedAt: sp.taken_at,
      blockNumber: Number(sp.block_number),
      total: wageNum(total),
      buckets,
      lpTracked: sp.lp != null,
      sumGapWage: Math.abs(wageNum(gap < 0n ? -gap : gap)),
    };
  }

  // ---- Tiles A -----------------------------------------------------------------------------
  const pr = priceRes.data;
  const priceUsd = pr?.price_usd == null ? null : Number(pr.price_usd);
  const p24 =
    price24Res.data?.price_usd == null
      ? null
      : Number(price24Res.data.price_usd);
  const burnedNow = supply
    ? supply.buckets.find((b) => b.key === 'burned')!.amount
    : 0;
  const priceAgeMs = pr ? now - new Date(pr.taken_at).getTime() : Infinity;

  // ---- Furnace D ---------------------------------------------------------------------------
  const dailyRaw = dailyRes.data ?? [];
  let cum = 0;
  const daily = dailyRaw.map((d) => {
    const v = wageNum(d.burned);
    cum += v;
    return { day: d.day, burned: v, cumulative: cum };
  });
  const burnedInWindow = dailyRaw.reduce((a, d) => a + big(d.burned), 0n);
  const burnedAllEvents = (allBurnRes.data ?? []).reduce(
    (a, d) => a + big(d.burned),
    0n,
  );

  return {
    window: win,
    generatedAt: new Date(now).toISOString(),
    graduatedAt: gradRes.data?.block_time ?? null,
    tiles: {
      priceUsd,
      priceEth: pr?.price_eth == null ? null : Number(pr.price_eth),
      change24hPct:
        priceUsd != null && p24 ? ((priceUsd - p24) / p24) * 100 : null,
      // Fixed launch: total supply == circulating, so market cap = price × (total supply − burned).
      marketCapUsd:
        priceUsd != null && supply
          ? priceUsd * (supply.total - burnedNow)
          : null,
      liquidityUsd: pr?.liquidity_usd == null ? null : Number(pr.liquidity_usd),
      priceSource: pr?.source ?? null,
      priceUpdatedAt: pr?.taken_at ?? null,
      priceStale: priceAgeMs > 15 * 60_000,
      workRatioPct,
      workRatioCapped,
      sealedWage: wageNum(sealed),
      tradedWage: wageNum(vol),
      tradeVolumeSource,
      tradeVolume: {
        curveWage: wageNum(curveVol),
        poolWage: wageNum(poolVol),
        trades: Number(tv.trades ?? 0),
      },
    },
    patronage,
    supply,
    flow: {
      locked: wageNum(locked),
      sealed: wageNum(sealed),
      patrons: wageNum(big(f?.patrons)),
      lampOil: wageNum(big(f?.lampOil)),
      tithe: wageNum(big(f?.tithe)),
      furnace: wageNum(big(f?.furnaceBooked)),
      stillInEscrow: Math.max(wageNum(locked - sealed - refunded), 0),
      refunded: wageNum(refunded),
      jobs: {
        posted: f?.jobsPosted ?? 0,
        sealed: f?.jobsSealed ?? 0,
        refunded: f?.jobsRefunded ?? 0,
        disputed: f?.jobsDisputed ?? 0,
      },
      splitSource: 'events',
    },
    furnace: {
      // Total terbakar = saldo dEaD (sama dengan Blockscout, acceptance §7). Event Burned hanya
      // melihat burn lewat Splitter; saldo dEaD bisa lebih besar kalau pihak lain ikut membakar.
      burnedAllTime: burnedNow || wageNum(burnedAllEvents),
      burnedInWindow: wageNum(burnedInWindow),
      pctOfSupply:
        ((burnedNow || wageNum(burnedAllEvents)) / WAGE_TOTAL_SUPPLY_CAP) * 100,
      booked: wageNum(big(f?.furnaceBooked)),
      daily,
      latest: (burnsRes.data ?? []).map((b) => ({
        txHash: b.tx_hash,
        at: b.block_time,
        amount: wageNum(b.amount),
      })),
    },
    indexer: {
      lastBlock: stateRes.data ? Number(stateRes.data.last_block) : null,
    },
  };
}

export async function getPriceSeries(range: '24h' | '7d' | '30d') {
  const ms =
    range === '24h'
      ? 86_400_000
      : range === '30d'
        ? 30 * 86_400_000
        : 7 * 86_400_000;
  const db = createServiceRoleClient();
  const since = new Date(Date.now() - ms).toISOString();
  const { data } = await db
    .from('price_snapshots')
    .select('taken_at,price_usd,price_eth,source')
    .gte('taken_at', since)
    .order('taken_at');
  return {
    range,
    points: (data ?? []).map((p) => ({
      t: p.taken_at,
      usd: p.price_usd == null ? null : Number(p.price_usd),
      eth: p.price_eth == null ? null : Number(p.price_eth),
    })),
    source: data?.at(-1)?.source ?? null,
  };
}

export async function getTopBuildings(win: Win) {
  const { data } = await createServiceRoleClient().rpc(
    'weighhouse_top_buildings',
    { p_since: sinceFor(win), p_limit: 10 },
  );
  return (data ?? []).map((r) => ({
    agentId: r.agent_id,
    name: r.name,
    sigil: r.code,
    ward: r.district,
    sealed: wageNum(r.sealed),
    jobs: Number(r.jobs),
    // base unit (string, 0019) -> WAGE utuh; stake on-chain sekarang, bukan jendela waktu.
    staked: wageNum(r.staked),
    rating: r.rating == null ? null : Number(r.rating),
  }));
}

export async function getLedger(limit = 50) {
  const db = createServiceRoleClient();
  const { data } = await db
    .from('chain_events')
    .select(
      'tx_hash,log_index,block_time,contract,event,chain_job_id,amount,args',
    )
    .in('event', LEDGER_EVENT_NAMES)
    .order('block_time', { ascending: false })
    .order('log_index', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  const rows = data ?? [];

  const ids = [
    ...new Set(rows.map((e) => e.chain_job_id).filter((x): x is string => !!x)),
  ];
  const jobs = ids.length
    ? ((await db.from('jobs').select('id,chain_job_id').in('chain_job_id', ids))
        .data ?? [])
    : [];
  const map = new Map(jobs.map((j) => [j.chain_job_id, j.id]));

  // Event Patronage (dan JobSplit/JobRegistered Splitter v2) membawa args.agentId = bytes32 on-chain;
  // dipetakan ke nama bangunan lewat agents.chain_agent_id (0018). Tidak terpetakan -> building null.
  const chainAgentIds = [
    ...new Set(
      rows
        .map((e) => (e.args as Record<string, unknown> | null)?.agentId)
        .filter((x): x is string => typeof x === 'string' && /^0x[0-9a-f]{64}$/.test(x)),
    ),
  ];
  const buildingRows = chainAgentIds.length
    ? ((
        await db
          .from('agents')
          .select('id,name,chain_agent_id')
          .in('chain_agent_id', chainAgentIds)
      ).data ?? [])
    : [];
  const buildingByChainId = new Map(
    buildingRows.map((a) => [a.chain_agent_id, { id: a.id, name: a.name }]),
  );

  return rows.map((e) => {
    const agentArg = (e.args as Record<string, unknown> | null)?.agentId;
    return {
      txHash: e.tx_hash,
      logIndex: e.log_index,
      at: e.block_time,
      event: e.event,
      kind: EVENT_KIND[e.event] ?? e.event,
      amount: e.amount == null ? null : wageNum(e.amount),
      // Staked membawa args.user (wallet patron); event lain tidak.
      wallet:
        typeof (e.args as Record<string, unknown> | null)?.user === 'string'
          ? ((e.args as Record<string, unknown>).user as string)
          : null,
      jobId: e.chain_job_id ? (map.get(e.chain_job_id) ?? null) : null,
      building:
        typeof agentArg === 'string'
          ? (buildingByChainId.get(agentArg) ?? null)
          : null,
    };
  });
}
export type LedgerRow = Awaited<ReturnType<typeof getLedger>>[number];
export type TopBuilding = Awaited<ReturnType<typeof getTopBuildings>>[number];
