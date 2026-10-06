'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MotionFooter, MotionHeader, MotionPage } from '@/components/motion/primitives';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SiteLogo } from '@/components/site-logo';
import { SiteNav } from '@/components/site-nav';
import { WalletConnect } from '@/components/wallet-connect';
import { cn } from '@/lib/cn';
import type { PoolView } from '@/lib/patronage-onchain';
import {
  filterPools,
  parseBase,
  rewardPer1000,
  sortPools,
  type PoolSortKey,
  type WardFilter,
} from '@/lib/patronage-page';
import { DEFAULT_WAGE_DECIMALS, formatWageExact, formatWageUnits } from '@/lib/wage-format';
import { PATRONAGE_LABEL } from '@/lib/wording';
import { explorerAddress, explorerBlock } from '@/lib/web3/addresses';
import { DISTRICT_ORDER, WARD_COLOR_HEX, WARD_LABEL } from '@/types/domain';
import type { DistrictId } from '@/types/enums';
import { PositionPanel } from './position-panel';
import { useMyPosition } from './use-my-position';

const POLL_MS = 60_000;

const SORTS: { key: PoolSortKey; label: string }[] = [
  { key: 'staked', label: 'Most staked' },
  { key: 'wages7d', label: 'Most wages sealed' },
];

export interface ContractLink {
  label: string;
  address: string;
}

const isWard = (v: string): v is DistrictId => (DISTRICT_ORDER as string[]).includes(v);

export function PatronageClient({
  initialPools,
  initialIndexedBlock,
  initialFailed,
  live,
  contracts,
}: {
  initialPools: PoolView[];
  initialIndexedBlock: number | null;
  /** Pembacaan daftar pool di server gagal (tabel belum dimigrasi / Supabase belum siap). */
  initialFailed: boolean;
  /** Alamat Patronage terisi di env (server atau browser). false = fitur belum aktif. */
  live: boolean;
  contracts: ContractLink[];
}) {
  const [pools, setPools] = useState(initialPools);
  const [indexedBlock, setIndexedBlock] = useState(initialIndexedBlock);
  const [failed, setFailed] = useState(initialFailed);
  const [sort, setSort] = useState<PoolSortKey>('staked');
  const [ward, setWard] = useState<WardFilter>('all');

  // Data pool dimuat sekali dari server dan dimuat ulang berkala lewat /api/patronage/pools.
  // Urutan dan filter dikerjakan di browser dari data yang sama, jadi berganti urutan instan.
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/patronage/pools?sort=staked');
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { pools: PoolView[]; indexedBlock: number | null };
      setPools(j.pools);
      setIndexedBlock(j.indexedBlock);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [live, load]);

  const my = useMyPosition(pools);

  const wardsPresent = useMemo(() => new Set(pools.map((p) => p.ward)), [pools]);
  const rows = useMemo(() => sortPools(filterPools(pools, ward), sort), [pools, ward, sort]);

  const mine = useMemo(() => {
    const m = new Map<string, { staked: bigint; pending: bigint }>();
    if (my.pos.ready) {
      for (const r of my.pos.rows) {
        if (r.staked > 0n || r.pending > 0n) m.set(r.chainAgentId.toLowerCase(), r);
      }
    }
    return m;
  }, [my.pos.ready, my.pos.rows]);
  const showMine = mine.size > 0;

  return (
    <MotionPage className="flex flex-col gap-3 p-3">
      <MotionHeader className="flex flex-wrap items-center gap-3">
        <SiteLogo />
        <SiteNav />
        <p className="hidden text-[13px] italic text-muted sm:block">
          The Patrons&apos; Hall · who holds the buildings up
        </p>
        <div className="ml-auto flex items-center gap-2">
          <WalletConnect />
        </div>
      </MotionHeader>

      <PositionPanel my={my} />

      <Panel>
        <PanelHeader
          title="Buildings"
          action={
            <div
              role="group"
              aria-label="Sort buildings"
              className="flex rounded-full border border-line bg-surface p-0.5"
            >
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSort(s.key)}
                  aria-pressed={sort === s.key}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[12px] text-muted transition-colors',
                    sort === s.key && 'bg-surface-2 text-text',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          }
        />

        <div
          role="group"
          aria-label="Filter by ward"
          className="flex flex-wrap gap-1.5 border-b border-line px-3.5 py-2.5"
        >
          <WardChip active={ward === 'all'} onClick={() => setWard('all')}>
            All wards
          </WardChip>
          {DISTRICT_ORDER.map((d) => (
            <WardChip
              key={d}
              active={ward === d}
              dim={!wardsPresent.has(d)}
              color={WARD_COLOR_HEX[d]}
              onClick={() => setWard(d)}
            >
              {WARD_LABEL[d]}
            </WardChip>
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyPools live={live} failed={failed} hasAny={pools.length > 0} onRetry={() => void load()} onReset={() => setWard('all')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wider text-faint">
                  <td colSpan={showMine ? 4 : 3} />
                  <th
                    scope="colgroup"
                    colSpan={3}
                    className="border-x border-line bg-surface-2/40 px-3 py-1.5 text-center font-medium normal-case tracking-normal text-muted"
                  >
                    {PATRONAGE_LABEL.historical}
                  </th>
                </tr>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-wider text-faint">
                  <th scope="col" className="px-3.5 py-2 font-medium">Building</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Staked</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Patrons</th>
                  {showMine && <th scope="col" className="px-3 py-2 text-right font-medium">Yours</th>}
                  <th scope="col" className="border-l border-line px-3 py-2 text-right font-medium">Wages sealed</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Paid to patrons</th>
                  <th scope="col" className="border-r border-line px-3 py-2 text-right font-medium" title="Patron rewards paid per 1,000 $WAGE staked today. Past 7 days, not a forecast.">
                    Per 1,000 staked
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <PoolRow key={p.chainAgentId} pool={p} mine={showMine ? mine.get(p.chainAgentId.toLowerCase()) : undefined} showMine={showMine} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-faint">
          {PATRONAGE_LABEL.historical}. Wages sealed and rewards paid are what happened in the last 7
          days; the last column is today&apos;s pool measured against them. It describes the past and
          says nothing about next week.{' '}
          {indexedBlock !== null ? (
            <>
              Table data runs up to block{' '}
              <a
                href={explorerBlock(indexedBlock)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono underline decoration-dotted underline-offset-2 hover:text-text"
              >
                {indexedBlock.toLocaleString('en-US')}
              </a>
              , a few minutes behind the chain. Your position above is read live from the contract.
            </>
          ) : (
            'Table data comes from an indexer that runs a few minutes behind the chain.'
          )}
          {live && failed && pools.length > 0 && (
            <span className="text-warn"> The last refresh failed, so these numbers may be stale.</span>
          )}
        </p>
      </Panel>

      <MotionFooter className="flex flex-col items-center gap-2 pb-2 text-center text-[11px] text-faint">
        {contracts.length > 0 && (
          <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            {contracts.map((c) => (
              <li key={c.label}>
                {c.label}{' '}
                <a
                  href={explorerAddress(c.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={c.address}
                  className="font-mono underline decoration-dotted underline-offset-2 hover:text-text"
                >
                  {c.address.slice(0, 6)}…{c.address.slice(-4)} ↗
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="max-w-2xl">
          Patron rewards are a share of wages that clients actually seal. A building with no work pays
          nothing, and $WAGE in cooldown earns nothing. Nothing here is a promise of any amount. Smart
          contracts carry risk, including bugs. Not financial advice.
        </p>
        <p>No coin leaves the Hold without a human seal.</p>
      </MotionFooter>
    </MotionPage>
  );
}

function WardChip({
  active,
  dim,
  color,
  onClick,
  children,
}: {
  active: boolean;
  dim?: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
        active ? 'border-gold/60 bg-surface-2 text-text' : 'border-line text-muted hover:text-text',
        dim && !active && 'opacity-50',
      )}
    >
      {color && <span aria-hidden="true" className="size-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

function PoolRow({
  pool: p,
  mine,
  showMine,
}: {
  pool: PoolView;
  mine: { staked: bigint; pending: bigint } | undefined;
  showMine: boolean;
}) {
  const d = DEFAULT_WAGE_DECIMALS;
  const staked = parseBase(p.totalStaked);
  const per1000 = rewardPer1000(p.paidToPatrons7d, p.totalStaked, d);
  const ward: DistrictId | null = isWard(p.ward) ? p.ward : null;

  return (
    <tr className="border-b border-line/60 last:border-b-0 hover:bg-surface-2/30">
      <td className="px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ background: ward ? WARD_COLOR_HEX[ward] : undefined }}
          />
          <div className="min-w-0">
            <Link
              href={`/agents/${p.agentId}`}
              className="text-text underline decoration-dotted underline-offset-2 hover:text-gold"
            >
              {p.name}
            </Link>
            <span className="ml-1.5 font-mono text-[11px] text-gold">{p.code}</span>
            <div className="text-[11px] text-faint">
              {ward ? WARD_LABEL[ward] : p.ward}
              {!p.registered && ' · closed to new stakes'}
            </div>
          </div>
        </div>
      </td>
      <Num title={formatWageExact(staked, d)}>{formatWageUnits(staked, { decimals: d })}</Num>
      <Num>{p.patronCount.toLocaleString('en-US')}</Num>
      {showMine && (
        <td className="px-3 py-2.5 text-right font-mono">
          {mine ? (
            <>
              <div className="text-text">{formatWageUnits(mine.staked, { decimals: d })}</div>
              {mine.pending > 0n && (
                <div className="text-[11px] text-gold">
                  {formatWageUnits(mine.pending, { decimals: d, maxFraction: 4 })} waiting
                </div>
              )}
            </>
          ) : (
            <span className="text-faint">—</span>
          )}
        </td>
      )}
      <Num className="border-l border-line" title={formatWageExact(parseBase(p.sealed7d), d)}>
        {formatWageUnits(parseBase(p.sealed7d), { decimals: d })}
        <div className="text-[11px] text-faint">
          {p.jobsSealed7d} {p.jobsSealed7d === 1 ? 'job' : 'jobs'}
        </div>
      </Num>
      <Num title={formatWageExact(parseBase(p.paidToPatrons7d), d)}>
        {formatWageUnits(parseBase(p.paidToPatrons7d), { decimals: d })}
      </Num>
      <Num
        className="border-r border-line"
        title={per1000 === null ? 'Nothing is staked here right now.' : formatWageExact(per1000, d)}
      >
        {per1000 === null ? <span className="text-faint">—</span> : formatWageUnits(per1000, { decimals: d })}
      </Num>
    </tr>
  );
}

function Num({
  children,
  title,
  className,
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <td title={title} className={cn('px-3 py-2.5 text-right font-mono text-text', className)}>
      {children}
    </td>
  );
}

function EmptyPools({
  live,
  failed,
  hasAny,
  onRetry,
  onReset,
}: {
  live: boolean;
  failed: boolean;
  hasAny: boolean;
  onRetry: () => void;
  onReset: () => void;
}) {
  let text: string;
  let action: React.ReactNode = null;

  if (!live) {
    text = "Patronage isn't live on this network yet. The buildings appear here once the contracts are deployed.";
  } else if (hasAny) {
    text = 'No building in this ward is open for patronage.';
    action = (
      <Button size="small" onClick={onReset}>
        Show all wards
      </Button>
    );
  } else if (failed) {
    text = "Couldn't load the building list.";
    action = (
      <Button size="small" onClick={onRetry}>
        Retry
      </Button>
    );
  } else {
    text = 'No building is open for patronage yet.';
  }

  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[12.5px] text-muted">
      <p>{text}</p>
      {action}
    </div>
  );
}
