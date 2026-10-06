'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MotionFooter,
  MotionHeader,
  MotionPage,
} from '@/components/motion/primitives';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SiteLogo } from '@/components/site-logo';
import { SiteNav } from '@/components/site-nav';
import { WalletConnect } from '@/components/wallet-connect';
import { cn } from '@/lib/cn';
import { useRealtimeChanges } from '@/lib/supabase/realtime';
import {
  ADDRESSES,
  PONS_TOKEN_URL,
  explorerAddress,
  explorerToken,
  explorerTx,
} from '@/lib/web3/addresses';
import { ledgerHint, ledgerSentence } from '@/lib/patronage-city';
import type {
  LedgerRow,
  PatronageSummary,
  Summary,
  TopBuilding,
  Win,
} from '@/lib/weighhouse/metrics';
import { BurnChart, PriceChart } from './charts';
import {
  ago,
  fmtPct,
  fmtPriceUsd,
  fmtUsd,
  fmtWage,
  fmtWageUnit,
  shortHash,
} from './format';
import { Badge, Empty, Tip } from './ui';

// Warna sesuai kota (brief §6).
const C = {
  patrons: '#5FB3B0',
  lampOil: '#56608A',
  tithe: '#E6C36A',
  furnace: '#E27070',
};
const WARD_DOT: Record<string, string> = {
  research: '#5fb3b0',
  onchain: '#e0a458',
  creative: '#d9776b',
  security: '#9c8be0',
  community: '#8dbf7f',
};
const BUCKET_COLOR: Record<string, string> = {
  burned: C.furnace,
  curve: '#9c8be0',
  lp: '#e0a458',
  locker: '#6c7392',
  strongbox: C.patrons,
  splitter: '#8dbf7f',
  patronage: '#d98fb4',
  treasuries: C.tithe,
  circulating: '#2e3556',
};
const WINDOWS: Win[] = ['24h', '7d', 'all'];
const WIN_LABEL: Record<Win, string> = { '24h': '24h', '7d': '7d', all: 'All' };
const WIN_PHRASE: Record<Win, string> = {
  '24h': 'in the last 24h',
  '7d': 'in the last 7 days',
  all: 'all time',
};

type Range = '24h' | '7d' | '30d';
type PriceSeries = {
  range: Range;
  points: { t: string; usd: number | null; eth: number | null }[];
  source: string | null;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export function WeighhouseClient({
  initialSummary,
  initialLedger,
  initialTop,
  initialPrice,
}: {
  initialSummary: Summary | null;
  initialLedger: LedgerRow[];
  initialTop: TopBuilding[];
  initialPrice: PriceSeries | null;
}) {
  const [win, setWin] = useState<Win>('7d');
  const [summary, setSummary] = useState(initialSummary);
  const [ledger, setLedger] = useState(initialLedger);
  const [top, setTop] = useState(initialTop);
  const [range, setRange] = useState<Range>('7d');
  const [price, setPrice] = useState(initialPrice);
  const [flare, setFlare] = useState(false);
  const winRef = useRef(win);
  useEffect(() => {
    winRef.current = win;
  }, [win]);

  const refreshWindowed = useCallback(async (w: Win) => {
    const [s, t] = await Promise.all([
      getJson<Summary>(`/api/weighhouse/summary?window=${w}`),
      getJson<TopBuilding[]>(`/api/weighhouse/top-buildings?window=${w}`),
    ]);
    if (w !== winRef.current) return; // jendela sudah diganti
    if (s) setSummary(s);
    if (t) setTop(t);
  }, []);

  const refreshLedger = useCallback(async () => {
    const l = await getJson<LedgerRow[]>('/api/weighhouse/ledger?limit=50');
    if (l) setLedger(l);
  }, []);

  // Ganti jendela waktu (A: Work Ratio, C, D, F).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    refreshWindowed(win);
  }, [win, refreshWindowed]);

  // Ganti rentang grafik harga.
  const firstRange = useRef(true);
  useEffect(() => {
    if (firstRange.current) {
      firstRange.current = false;
      return;
    }
    getJson<PriceSeries>(`/api/weighhouse/price?range=${range}`).then(
      (p) => p && setPrice(p),
    );
  }, [range]);

  // Realtime: event chain baru -> ledger + counter ikut bergerak (debounce 2 dtk).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtimeChanges('chain_events', (payload) => {
    const ev = (payload.new as { event?: string } | null)?.event;
    if (ev === 'Burned') {
      setFlare(true);
      setTimeout(() => setFlare(false), 2500);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      refreshLedger();
      refreshWindowed(winRef.current);
    }, 2000);
  });

  // Peringatan dev (brief §7): bucket supply harus menjumlah ke totalSupply dalam 1 WAGE.
  useEffect(() => {
    const s = summary?.supply;
    if (!s) return;
    const sum = s.buckets.reduce((a, b) => a + b.amount, 0);
    if (Math.abs(sum - s.total) > 1)
      console.warn(
        `[Weighhouse] supply buckets sum ${sum} != totalSupply ${s.total}`,
      );
    const circ = s.buckets.find((b) => b.key === 'circulating');
    if (circ && circ.amount < 0)
      console.warn(
        '[Weighhouse] circulating < 0: kemungkinan bucket tumpang-tindih (curve/LP/locker).',
      );
  }, [summary]);

  const t = summary?.tiles;
  const noData = !summary || (!summary.supply && !t?.priceUsd);

  return (
    <MotionPage className="flex flex-col gap-3 p-3">
      <MotionHeader className="flex flex-wrap items-center gap-3">
        <SiteLogo />
        <SiteNav />
        <p className="hidden text-[13px] italic text-muted sm:block">
          The Weighhouse · every WAGE, weighed
        </p>
        <div className="ml-auto flex items-center gap-2">
          <div
            role="group"
            aria-label="Time window"
            className="flex rounded-full border border-line bg-surface p-0.5"
          >
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWin(w)}
                aria-pressed={win === w}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[12px] text-muted transition-colors',
                  win === w && 'bg-surface-2 text-text',
                )}
              >
                {WIN_LABEL[w]}
              </button>
            ))}
          </div>
          <WalletConnect />
        </div>
      </MotionHeader>

      {noData && (
        <Panel>
          <Empty>
            No chain data yet. The indexer fills this page once{' '}
            <code>WEIGHHOUSE_DEPLOY_BLOCK</code> is set and the cron has run.
          </Empty>
        </Panel>
      )}

      {/* A. Headline tiles */}
      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Headline metrics"
      >
        <Tile
          label="Price"
          tip={{
            f: 'Latest $WAGE trade price from the newest price snapshot.',
            href: explorerToken(ADDRESSES.wageToken),
          }}
          value={fmtPriceUsd(t?.priceUsd ?? null)}
          sub={
            <>
              {t?.change24hPct != null && (
                <span
                  className={t.change24hPct >= 0 ? 'text-good' : 'text-crit'}
                >
                  {t.change24hPct >= 0 ? '+' : ''}
                  {t.change24hPct.toFixed(2)}% 24h
                </span>
              )}
              <span className="text-faint">
                {t?.priceSource
                  ? ` Source: ${t.priceSource === 'bitquery' ? 'Bitquery' : 'on-chain'} · ${ago(t.priceUpdatedAt)}`
                  : 'No price source yet'}
              </span>
              {t?.priceStale && t.priceSource && (
                <>
                  {' '}
                  <Badge tone="warn">stale</Badge>
                </>
              )}
            </>
          }
        />
        <Tile
          label="Market cap"
          tip={{
            f: 'Price × (total supply − burned). Fixed launch, so total supply is the circulating supply.',
          }}
          value={fmtUsd(t?.marketCapUsd ?? null)}
          sub={<span className="text-faint">Price × supply</span>}
        />
        <Tile
          label="Liquidity"
          tip={{
            f: 'Quote-side reserves in the curve (pre-graduation) or the Uniswap v4 pool (post-graduation), in USD.',
          }}
          value={fmtUsd(t?.liquidityUsd ?? null)}
          sub={
            <span className="text-faint">
              {t?.liquidityUsd == null
                ? 'Not tracked yet'
                : 'Quote-side reserves'}
            </span>
          }
        />
        <Tile
          label="Work Ratio"
          accent
          tip={{
            f: 'Σ sealed wages ÷ Σ $WAGE traded (curve + v4 pool), same window. Sealed = SealSet amounts + the payee share of resolved disputes.',
          }}
          value={
            t?.workRatioPct == null
              ? '—'
              : `${fmtPct(t.workRatioPct)}${t.workRatioCapped ? '+' : ''}`
          }
          sub={
            <span className="text-faint">
              Share of $WAGE movement that came from paid work.{' '}
              {t && t.tradeVolumeSource === 'none'
                ? 'No trades in this window.'
                : t
                  ? `${fmtWageUnit(t.sealedWage)} sealed / ${fmtWageUnit(t.tradedWage)} traded.`
                  : ''}
            </span>
          }
        />
      </section>

      {/* B. Supply */}
      <Panel>
        <PanelHeader
          title="Supply"
          action={
            <span className="text-[11px] text-faint">
              {summary?.supply
                ? `Block ${summary.supply.blockNumber} · ${ago(summary.supply.updatedAt)}`
                : ''}
            </span>
          }
        />
        {summary?.supply ? (
          <SupplyBlock
            supply={summary.supply}
            patronage={summary.patronage}
          />
        ) : (
          <Empty>No supply snapshot yet.</Empty>
        )}
      </Panel>

      {/* C + D */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Utility flow"
            action={
              <span className="text-[11px] text-faint">{WIN_PHRASE[win]}</span>
            }
          />
          {summary ? (
            <FlowBlock flow={summary.flow} />
          ) : (
            <Empty>No flow data.</Empty>
          )}
        </Panel>
        <Panel
          className={cn(
            'transition-shadow duration-700',
            flare && 'shadow-[0_0_0_1px_#E27070,0_0_24px_#E2707066]',
          )}
        >
          <PanelHeader
            title="Furnace (burn)"
            action={
              <span className="text-[11px] text-faint">{WIN_PHRASE[win]}</span>
            }
          />
          {summary ? (
            <FurnaceBlock f={summary.furnace} win={win} />
          ) : (
            <Empty>No burn data.</Empty>
          )}
        </Panel>
      </div>

      {/* E + F */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Price"
            action={
              <div className="flex gap-1">
                {(['24h', '7d', '30d'] as Range[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    aria-pressed={range === r}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] text-muted',
                      range === r && 'bg-surface-2 text-text',
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            }
          />
          <div className="p-3.5">
            {price && price.points.length >= 2 ? (
              <PriceChart
                points={price.points}
                graduatedAt={
                  summary?.graduatedAt ??
                  process.env.NEXT_PUBLIC_WAGE_GRADUATED_AT
                }
              />
            ) : (
              <Empty>No price snapshots in this range.</Empty>
            )}
            {price?.source && (
              <p className="mt-1 text-[11px] text-faint">
                Source: {price.source === 'bitquery' ? 'Bitquery' : 'on-chain'}
              </p>
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHeader
            title="Top buildings"
            action={
              <span className="text-[11px] text-faint">
                by sealed wages · {WIN_PHRASE[win]}
              </span>
            }
          />
          <TopTable rows={top} />
        </Panel>
      </div>

      {/* G. Ledger */}
      <Panel>
        <PanelHeader
          title="On-chain ledger"
          action={
            <span className="text-[11px] text-faint">
              latest {ledger.length} events
            </span>
          }
        />
        <LedgerTable rows={ledger} />
      </Panel>

      <MotionFooter className="flex flex-col items-center gap-2 pb-2 text-center text-[11px] text-faint">
        <p>No coin leaves the Hold without a human seal.</p>
        <CaBlock />
        <p>Market data is informational. Not financial advice.</p>
      </MotionFooter>
    </MotionPage>
  );
}

// ---- pieces ---------------------------------------------------------------------------------

function Tile({
  label,
  value,
  sub,
  tip,
  accent,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  tip: { f: string; href?: string };
  accent?: boolean;
}) {
  return (
    <Panel className={cn('p-3.5', accent && 'border-gold/40')}>
      <div className="text-[11px] uppercase tracking-wide text-muted">
        <Tip formula={tip.f} href={tip.href}>
          {label}
        </Tip>
      </div>
      <div
        className={cn(
          'mt-1 font-display text-[26px] font-semibold leading-tight',
          accent ? 'text-gold' : 'text-text',
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[11.5px] leading-snug">{sub}</div>
    </Panel>
  );
}

function SupplyBlock({
  supply,
  patronage,
}: {
  supply: NonNullable<Summary['supply']>;
  patronage: PatronageSummary;
}) {
  const bars = supply.buckets.filter((b) => b.amount > 0);
  return (
    <div className="p-3.5">
      <div
        className="flex h-5 w-full overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label="Supply breakdown"
      >
        {bars.map((b) => (
          <div
            key={b.key}
            style={{
              width: `${Math.max(b.pct, 0.4)}%`,
              background: BUCKET_COLOR[b.key],
            }}
            title={`${b.label}: ${fmtWageUnit(b.amount)} (${b.pct.toFixed(2)}%)`}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[11.5px] text-faint">
        Total supply {fmtWageUnit(supply.total)}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[12.5px]">
          <thead className="text-[11px] uppercase text-faint">
            <tr>
              <th className="py-1 font-normal">Bucket</th>
              <th className="py-1 text-right font-normal">Amount</th>
              <th className="py-1 text-right font-normal">% of supply</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {supply.buckets.map((b) => (
              <tr key={b.key} className="border-t border-line/60">
                <td className="py-1.5">
                  <span
                    className="mr-2 inline-block h-2 w-2 rounded-full"
                    style={{ background: BUCKET_COLOR[b.key] }}
                  />
                  {b.label} <span className="text-faint">({b.plain})</span>
                  {b.note && (
                    <>
                      {' '}
                      <Badge tone="warn">{b.note}</Badge>
                    </>
                  )}
                </td>
                <td className="py-1.5 text-right font-mono text-[12px]">
                  {fmtWageUnit(b.amount)}
                </td>
                <td className="py-1.5 text-right font-mono text-[12px]">
                  {b.pct.toFixed(2)}%
                </td>
                <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                  {b.links?.map((l) => (
                    <a
                      key={l.address}
                      className="ml-2 text-gold hover:underline"
                      target="_blank"
                      rel="noreferrer"
                      title={l.label}
                      aria-label={`${l.label} on Blockscout`}
                      href={explorerAddress(l.address)}
                    >
                      ↗
                    </a>
                  ))}
                </td>
              </tr>
            ))}
            {/* Memo (bukan bucket): turunan event Patronage dari indexer, semua waktu. Stake sudah termasuk di
                bucket "Patronage" di atas (saldo kontrak). */}
            <PatronageMemoRows patronage={patronage} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PatronageMemoRows({ patronage }: { patronage: PatronageSummary }) {
  const note = !patronage.configured
    ? "Patronage isn't live on this network yet"
    : !patronage.ok
      ? 'Patronage data is unavailable right now'
      : null;
  const value = (n: number) => (note ? '—' : fmtWageUnit(n, 2));
  return (
    <>
      <tr className="border-t border-line/60 text-faint">
        <td className="py-1.5">
          <Tip formula="Σ stake of every patron in every building, derived from Staked and UnstakeRequested events. Included in the Patronage balance above. Indexer data lags the chain by a few minutes.">
            Staked by patrons
          </Tip>{' '}
          <span>(on-chain)</span>
        </td>
        <td className="py-1.5 text-right font-mono text-[12px]">
          {value(patronage.stakedWage)}
        </td>
        <td className="py-1.5 text-right text-[11px]" colSpan={2}>
          {note ??
            `${patronage.patrons} ${patronage.patrons === 1 ? 'patron' : 'patrons'} · ${patronage.buildings} ${patronage.buildings === 1 ? 'building' : 'buildings'}`}
        </td>
      </tr>
      <tr className="border-t border-line/60 text-faint">
        <td className="py-1.5">
          <Tip formula="Σ RewardNotified events: the patrons' share of sealed wages that was shared among staked patrons. All time. A past amount, not a forecast.">
            Patron rewards paid
          </Tip>{' '}
          <span>(all time)</span>
        </td>
        <td className="py-1.5 text-right font-mono text-[12px]">
          {value(patronage.rewardsPaidWage)}
        </td>
        <td className="py-1.5 text-right text-[11px]" colSpan={2}>
          {note ?? (
            <Tip
              className="justify-end"
              formula="Σ RewardRedirected events: when a building had no staked patron at the moment a wage was sealed, the patrons' share went to the treasury instead."
            >
              {fmtWageUnit(patronage.redirectedWage, 2)} redirected to treasury
            </Tip>
          )}
        </td>
      </tr>
    </>
  );
}

function FlowRow({
  label,
  value,
  color,
  tip,
  max,
  href,
}: {
  label: string;
  value: number;
  color: string;
  tip: string;
  max: number;
  href?: string;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr_auto] items-center gap-2 py-1 text-[12.5px]">
      <Tip formula={tip} href={href}>
        {label}
      </Tip>
      <div>
        <div
          className="h-2 rounded-full"
          style={{
            width: `${Math.max((value / max) * 100, value > 0 ? 2 : 0)}%`,
            background: color,
          }}
        />
      </div>
      <span className="font-mono text-[12px]">{fmtWageUnit(value)}</span>
    </div>
  );
}

function FlowBlock({ flow }: { flow: Summary['flow'] }) {
  const max = Math.max(flow.locked, flow.sealed, 1);
  const empty = flow.locked === 0 && flow.sealed === 0;
  return (
    <div className="p-3.5">
      {empty && (
        <p className="mb-2 text-[12.5px] text-faint">
          No wages moved through the Strongbox in this window.
        </p>
      )}
      <FlowRow
        max={max}
        label="Wages locked"
        value={flow.locked}
        color={C.patrons}
        tip="Σ JobFunded amounts on the Strongbox (escrow)."
        href={explorerAddress(ADDRESSES.strongbox)}
      />
      <FlowRow
        max={max}
        label="Wages sealed"
        value={flow.sealed}
        color={C.patrons}
        tip="Σ SealSet amounts + the payee share of DisputeResolved."
        href={explorerAddress(ADDRESSES.strongbox)}
      />
      <div className="ml-4 border-l border-line pl-3">
        <FlowRow
          max={max}
          label="Patrons 60%"
          value={flow.patrons}
          color={C.patrons}
          tip="Σ patronAmount from Splitter JobSplit events."
          href={explorerAddress(ADDRESSES.splitter)}
        />
        <FlowRow
          max={max}
          label="Lamp Oil 20%"
          value={flow.lampOil}
          color={C.lampOil}
          tip="Σ lampOilAmount from JobSplit (compute treasury)."
          href={explorerAddress(ADDRESSES.lampOilTreasury)}
        />
        <FlowRow
          max={max}
          label="Tithe 10%"
          value={flow.tithe}
          color={C.tithe}
          tip="Σ titheAmount from JobSplit (includes rounding dust)."
          href={explorerAddress(ADDRESSES.titheTreasury)}
        />
        <FlowRow
          max={max}
          label="Furnace 10%"
          value={flow.furnace}
          color={C.furnace}
          tip="Σ burnAmount booked by JobSplit. Actually burned only after Splitter.burn()."
          href={explorerAddress(ADDRESSES.splitter)}
        />
      </div>
      <div className="mt-1 text-[12px] text-faint">
        Still in escrow {fmtWageUnit(flow.stillInEscrow)} · refunded{' '}
        {fmtWageUnit(flow.refunded)}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px] text-muted">
        {(
          [
            ['posted', flow.jobs.posted],
            ['sealed', flow.jobs.sealed],
            ['refunded', flow.jobs.refunded],
            ['disputed', flow.jobs.disputed],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-md bg-surface-2 py-1.5">
            <div className="font-display text-[16px] text-text">{v}</div>
            {k}
          </div>
        ))}
      </div>
    </div>
  );
}

function FurnaceBlock({ f, win }: { f: Summary['furnace']; win: Win }) {
  return (
    <div className="p-3.5">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat
          label="Burned (all time)"
          tip="Balance of the dead address (0x…dEaD) + zero address, same as Blockscout."
          href={explorerAddress(ADDRESSES.furnace)}
          value={fmtWageUnit(f.burnedAllTime)}
        />
        <Stat
          label={`Burned ${win === 'all' ? '(all)' : `(${win})`}`}
          tip="Σ Burned events from the Splitter in this window."
          value={fmtWageUnit(f.burnedInWindow)}
        />
        <Stat
          label="% of supply"
          tip="Burned ÷ 1,000,000,000."
          value={`${f.pctOfSupply.toFixed(4)}%`}
        />
      </div>
      {f.daily.length ? (
        <div className="mt-3">
          <BurnChart data={f.daily} />
          <p className="text-[11px] text-faint">
            Bars: WAGE burned per UTC day · line: cumulative
          </p>
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] text-faint">
          The Furnace is cold. No wages sealed yet in this window.
        </p>
      )}
      {f.latest.length > 0 && (
        <ul className="mt-2 divide-y divide-line/60 text-[12px]">
          {f.latest.map((b) => (
            <li
              key={b.txHash}
              className="flex items-center justify-between gap-2 py-1"
            >
              <span className="font-mono text-faint">{ago(b.at)}</span>
              <span className="font-mono">{fmtWageUnit(b.amount)}</span>
              <a
                className="text-gold hover:underline"
                target="_blank"
                rel="noreferrer"
                href={explorerTx(b.txHash)}
              >
                {shortHash(b.txHash)} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
const Stat = ({
  label,
  value,
  tip,
  href,
}: {
  label: string;
  value: string;
  tip: string;
  href?: string;
}) => (
  <div className="rounded-md bg-surface-2 px-1 py-2">
    <div className="text-[10.5px] uppercase text-muted">
      <Tip formula={tip} href={href}>
        {label}
      </Tip>
    </div>
    <div className="mt-0.5 font-mono text-[12.5px] text-crit">{value}</div>
  </div>
);

function TopTable({ rows }: { rows: TopBuilding[] }) {
  if (!rows.length) return <Empty>No sealed wages in this window.</Empty>;
  return (
    <div className="overflow-x-auto p-3.5">
      <table className="w-full min-w-[460px] text-left text-[12.5px]">
        <thead className="text-[11px] uppercase text-faint">
          <tr>
            <th className="font-normal">Building</th>
            <th className="text-right font-normal">Sealed</th>
            <th className="text-right font-normal">Jobs</th>
            <th className="text-right font-normal">Staked</th>
            <th className="text-right font-normal">Rating</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agentId} className="border-t border-line/60">
              <td className="py-1.5">
                <span
                  className="mr-2 inline-block h-2 w-2 rounded-full"
                  style={{ background: WARD_DOT[r.ward] ?? '#6c7392' }}
                />
                <Link href={`/agents/${r.agentId}`} className="hover:underline">
                  {r.name}
                </Link>{' '}
                <span className="font-mono text-xs text-gold">{r.sigil}</span>
              </td>
              <td className="text-right font-mono text-[12px]">
                {fmtWageUnit(r.sealed)}
              </td>
              <td className="text-right font-mono text-[12px]">{r.jobs}</td>
              <td className="text-right font-mono text-[12px]">
                {fmtWage(r.staked)}
              </td>
              <td className="text-right">
                {r.rating == null ? (
                  <span className="text-faint">No ratings yet</span>
                ) : (
                  r.rating.toFixed(1)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  if (!rows.length) return <Empty>No on-chain events indexed yet.</Empty>;
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full min-w-[680px] text-left text-[12.5px]">
        <thead className="sticky top-0 bg-surface text-[11px] uppercase text-faint">
          <tr>
            <th className="px-3.5 py-1.5 font-normal">Time</th>
            <th className="font-normal">Event</th>
            <th className="text-right font-normal">Amount</th>
            <th className="pl-4 font-normal">Building</th>
            <th className="pl-4 font-normal">Job</th>
            <th className="px-3.5 text-right font-normal">Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.txHash}:${r.logIndex}`}
              className="border-t border-line/60"
            >
              <td className="whitespace-nowrap px-3.5 py-1.5 font-mono text-faint">
                {ago(r.at)}
              </td>
              <td>
                <span title={ledgerHint(r.kind)}>
                  <Badge
                    tone={
                      r.kind === 'Burned'
                        ? 'warn'
                        : r.kind === 'Sealed' ||
                            r.kind === 'Staked' ||
                            r.kind === 'Patron reward'
                          ? 'good'
                          : 'muted'
                    }
                  >
                    {r.kind}
                  </Badge>
                </span>
                {(() => {
                  const sentence = ledgerSentence({
                    kind: r.kind,
                    amountText: r.amount == null ? null : fmtWageUnit(r.amount, 2),
                    building: r.building,
                    wallet: r.wallet,
                  });
                  return sentence ? (
                    <div className="mt-0.5 text-[11px] text-faint">{sentence}</div>
                  ) : null;
                })()}
              </td>
              <td className="text-right font-mono text-[12px]">
                {r.amount == null ? '—' : fmtWageUnit(r.amount, 2)}
              </td>
              <td className="pl-4">
                {r.building ? (
                  <Link
                    href={`/agents/${r.building.id}`}
                    className="hover:underline"
                  >
                    {r.building.name}
                  </Link>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </td>
              <td className="pl-4">
                {r.jobId ? (
                  <Link
                    href={`/jobs/${r.jobId}`}
                    className="text-gold hover:underline"
                  >
                    open ↗
                  </Link>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </td>
              <td className="px-3.5 text-right">
                <a
                  className="font-mono text-gold hover:underline"
                  target="_blank"
                  rel="noreferrer"
                  href={explorerTx(r.txHash)}
                >
                  {shortHash(r.txHash)} ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CaBlock() {
  const [copied, setCopied] = useState(false);
  const ca = ADDRESSES.wageToken;
  return (
    <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
      <span className="text-muted">$WAGE CA</span>
      <code className="max-w-full break-all rounded bg-surface-2 px-2 py-1 font-mono text-[11px] text-text">
        {ca}
      </code>
      <button
        className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:text-text"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(ca);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard diblokir */
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <a
        className="text-gold hover:underline"
        target="_blank"
        rel="noreferrer"
        href={explorerToken(ca)}
      >
        Blockscout ↗
      </a>
      {PONS_TOKEN_URL && (
        <a
          className="text-gold hover:underline"
          target="_blank"
          rel="noreferrer"
          href={PONS_TOKEN_URL}
        >
          Pons ↗
        </a>
      )}
    </div>
  );
}
