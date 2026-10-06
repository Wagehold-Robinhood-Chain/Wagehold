'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { TxStatus } from '@/components/tx-status';
import { ConnectWalletButton } from '@/components/wallet-connect';
import {
  hasPosition,
  parseBase,
  selectClaimBatch,
  sumPositions,
  type PositionRow,
} from '@/lib/patronage-page';
import { formatWageExact, formatWageUnits } from '@/lib/wage-format';
import { PATRONAGE_LABEL } from '@/lib/wording';
import { cooldownRemaining, formatDuration } from '@/lib/web3/patronage-rules';
import type { BuildingInfo, MyPosition } from './use-my-position';

/**
 * "Your position" di halaman /patronage (Dev Brief §8.1).
 *
 * Angka yang bisa berubah tiap detik (stake, cooldown, pending rewards) dibaca LIVE dari kontrak
 * lewat multicall untuk semua bangunan; API `/api/patronage/me` (indexer, tertinggal beberapa menit)
 * hanya dipakai untuk "Claimed so far" dan untuk menemukan bangunan yang belum ada di daftar pool.
 * Claim all = satu transaksi `claimMany`.
 */

function Stat({
  label,
  value,
  title,
  gold,
  children,
}: {
  label: string;
  value: string;
  title?: string;
  gold?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-bg px-3 py-2.5">
      <span className="text-[10.5px] uppercase tracking-wider text-faint">{label}</span>
      <span
        title={title}
        className={`truncate font-mono text-[15px] ${gold ? 'text-gold' : 'text-text'}`}
      >
        {value}
      </span>
      {children && <span className="text-[11px] text-muted">{children}</span>}
    </div>
  );
}

/** Dipasang hanya saat ada $WAGE cooldown, supaya jam `now` selalu segar saat mount. */
function UnlockHint({ unlockAt }: { unlockAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = cooldownRemaining(unlockAt, now);
  return <>{left === 0 ? 'Ready to withdraw.' : `Next unlock in ${formatDuration(left)}.`}</>;
}

const cmpDesc = (a: bigint, b: bigint) => (a === b ? 0 : a > b ? -1 : 1);
const shortId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;

export function PositionPanel({ my }: { my: MyPosition }) {
  const { gate, pos, actions, indexed, byId } = my;

  const dec = pos.decimals;
  const fmt = (n: bigint, maxFraction = 2) => formatWageUnits(n, { decimals: dec, maxFraction });
  const exact = (n: bigint) => formatWageExact(n, dec);

  let body: React.ReactNode;

  if (!pos.configured) {
    body = (
      <p className="text-[12.5px] text-muted">
        Patronage isn&apos;t live on this network yet. Positions show up here once the contracts are
        deployed.
      </p>
    );
  } else if (!gate.connected) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <ConnectWalletButton />
        <span className="text-[12.5px] text-muted">
          to see what you have staked, what is waiting to be claimed, and what is cooling down.
        </span>
      </div>
    );
  } else if (gate.wrongNetwork) {
    body = (
      <div className="flex flex-col items-start gap-1.5">
        <p className="text-[12.5px] text-warn">
          Your wallet is on a different network. Patronage lives on {gate.networkName}.
        </p>
        <Button
          size="small"
          variant="primary"
          disabled={gate.switching}
          onClick={() => void gate.switchNetwork()}
        >
          {gate.switching ? 'Switching…' : `Switch to ${gate.networkName}`}
        </Button>
        {gate.switchError && <p className="text-[11.5px] text-crit">{gate.switchError}</p>}
      </div>
    );
  } else if (pos.loadFailed) {
    body = (
      <div className="flex items-center gap-2 text-[12px] text-crit">
        <span>Couldn&apos;t read your positions from the contract.</span>
        <Button size="small" onClick={() => void pos.refetch()}>
          Retry
        </Button>
      </div>
    );
  } else if (!pos.ready) {
    body = <p className="text-[12.5px] text-faint">Reading your position…</p>;
  } else {
    const totals = sumPositions(pos.rows);
    const batch = selectClaimBatch(pos.rows);
    const listed = pos.rows.filter(hasPosition).sort((a, b) => cmpDesc(a.pending, b.pending) || cmpDesc(a.staked, b.staked));

    const claimed = indexed.data ? parseBase(indexed.data.totals.claimedTotal) : null;

    body = (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label={PATRONAGE_LABEL.staked} value={fmt(totals.staked)} title={exact(totals.staked)}>
            {totals.stakedBuildings > 0
              ? `in ${totals.stakedBuildings} ${totals.stakedBuildings === 1 ? 'building' : 'buildings'}`
              : 'nothing staked yet'}
          </Stat>
          <Stat label={PATRONAGE_LABEL.pendingRewards} value={fmt(totals.pending, 4)} title={exact(totals.pending)} gold>
            {totals.claimableBuildings > 0
              ? `waiting in ${totals.claimableBuildings} ${totals.claimableBuildings === 1 ? 'building' : 'buildings'}`
              : 'nothing to claim yet'}
          </Stat>
          <Stat label={PATRONAGE_LABEL.cooling} value={fmt(totals.cooling)} title={exact(totals.cooling)}>
            {totals.nextUnlockAt !== null ? <UnlockHint unlockAt={totals.nextUnlockAt} /> : 'earns nothing while it cools'}
          </Stat>
          <Stat
            label={PATRONAGE_LABEL.claimedToDate}
            value={claimed === null ? (indexed.failed ? '—' : '…') : fmt(claimed)}
            title={claimed === null ? undefined : exact(claimed)}
          >
            {indexed.failed && claimed === null ? 'history unavailable right now' : 'from the indexer, a few minutes behind'}
          </Stat>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              disabled={actions.busy || batch.ids.length === 0}
              onClick={() => void actions.claimMany(batch.ids)}
            >
              {PATRONAGE_LABEL.claimAll}
            </Button>
            <span className="text-[12px] text-muted">
              {batch.ids.length === 0
                ? 'No patron rewards are waiting.'
                : `${fmt(batch.total, 4)} from ${batch.ids.length} ${batch.ids.length === 1 ? 'building' : 'buildings'}, in one transaction.`}
            </span>
          </div>
          {batch.remaining > 0 && (
            <p className="text-[11.5px] text-faint">
              {batch.remaining} more {batch.remaining === 1 ? 'building has' : 'buildings have'} rewards waiting.
              They go in the next Claim all, once this one confirms.
            </p>
          )}
          <TxStatus tx={actions.tx} onDismiss={actions.reset} />
        </div>

        {listed.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            You aren&apos;t a patron anywhere yet. Pick a building below and stake from its profile.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-bg">
            {listed.map((r) => (
              <PositionLine key={r.chainAgentId} row={r} info={byId.get(r.chainAgentId)} fmt={fmt} exact={exact} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <Panel>
      <PanelHeader title="Your position" />
      <div className="p-3.5">{body}</div>
    </Panel>
  );
}

function PositionLine({
  row,
  info,
  fmt,
  exact,
}: {
  row: PositionRow;
  info: BuildingInfo | undefined;
  fmt: (n: bigint, maxFraction?: number) => string;
  exact: (n: bigint) => string;
}) {
  const name = info?.name || `Unlisted building ${shortId(row.chainAgentId)}`;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[12.5px]">
      <span className="min-w-0 flex-1 basis-40">
        {info?.agentId ? (
          <Link
            href={`/agents/${info.agentId}`}
            className="text-text underline decoration-dotted underline-offset-2 hover:text-gold"
          >
            {name}
          </Link>
        ) : (
          <span className="text-muted">{name}</span>
        )}
        {info?.code && <span className="ml-1.5 font-mono text-[11px] text-gold">{info.code}</span>}
      </span>
      <span className="font-mono text-muted" title={exact(row.staked)}>
        {fmt(row.staked)} <span className="text-faint">staked</span>
      </span>
      <span className={`font-mono ${row.pending > 0n ? 'text-gold' : 'text-faint'}`} title={exact(row.pending)}>
        {fmt(row.pending, 4)} <span className="text-faint">rewards</span>
      </span>
      {row.cooling > 0n && (
        <span className="font-mono text-muted" title={exact(row.cooling)}>
          {fmt(row.cooling)} <span className="text-faint">cooling</span>
        </span>
      )}
    </li>
  );
}
