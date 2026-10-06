'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TxStatus } from '@/components/tx-status';
import { ConnectWalletButton } from '@/components/wallet-connect';
import { WAGE_SPLIT, WAGE_TOKEN, formatWage } from '@/lib/currency';
import { explorerAddress } from '@/lib/web3/addresses';
import { patronageAddress } from '@/lib/web3/patronage';
import {
  checkStake,
  checkUnstake,
  cooldownRemaining,
  describeCooldown,
  formatDuration,
  maxStakeable,
} from '@/lib/web3/patronage-rules';
import {
  useNetworkGate,
  usePatronageActions,
  usePatronageBuilding,
} from '@/lib/web3/use-patronage';
import { formatWageExact, formatWageUnits, parseWageInput, toInputString } from '@/lib/wage-format';
import { PATRONAGE_LABEL } from '@/lib/wording';

/**
 * Patronage on-chain (Dev Brief §8.2): stake $WAGE pada sebuah bangunan untuk berbagi porsi patron
 * (WAGE_SPLIT.patronsPct) pro rata setiap kali client menyegel wage. Semua angka di panel ini
 * dibaca langsung dari kontrak WageholdPatronage.
 *
 * Alur: stake (approve dulu bila perlu) -> reward terkumpul tiap seal -> claim kapan saja.
 * Keluar: request unstake -> cooldown -> withdraw. $WAGE yang sedang cooldown tidak menghasilkan reward.
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
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line bg-bg px-2.5 py-2">
      <span className="text-[10.5px] uppercase tracking-wider text-faint">{label}</span>
      <span
        title={title}
        className={`truncate font-mono text-[12.5px] ${gold ? 'text-gold' : 'text-text'}`}
      >
        {value}
      </span>
      {children}
    </div>
  );
}

/** Baris cooldown: dipasang hanya saat ada $WAGE cooldown, sehingga jam `now` selalu segar saat mount. */
function CoolingRow({
  cooling,
  unlockAt,
  decimals,
  disabled,
  onWithdraw,
}: {
  cooling: bigint;
  unlockAt: number;
  decimals: number;
  disabled: boolean;
  onWithdraw: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const left = cooldownRemaining(unlockAt, now);
  const ready = left === 0;

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-bg px-2.5 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[10.5px] uppercase tracking-wider text-faint">
          {PATRONAGE_LABEL.cooling}
        </span>
        <span
          className="truncate font-mono text-[12.5px] text-text"
          title={formatWageExact(cooling, decimals)}
        >
          {formatWageUnits(cooling, { decimals, maxFraction: 4 })}
        </span>
        <span className="text-[11px] text-muted">
          {ready ? 'Ready to withdraw.' : `${formatDuration(left)} left. Earns nothing meanwhile.`}
        </span>
      </div>
      <Button size="small" disabled={disabled || !ready} onClick={onWithdraw}>
        {PATRONAGE_LABEL.withdraw}
      </Button>
    </div>
  );
}

export function PatronageSection({
  agentId,
  isLead,
}: {
  /** agents.id (uuid); bytes32 on-chain dihitung dari sini. */
  agentId: string;
  isLead: boolean;
}) {
  // Semua hook dipanggil sebelum return dini mana pun (aturan hooks).
  const b = usePatronageBuilding(agentId);
  const gate = useNetworkGate();
  const actions = usePatronageActions({ agentChainId: b.agentChainId, onSettled: b.refetch });

  const [mode, setMode] = useState<'stake' | 'unstake'>('stake');
  const [amountText, setAmountText] = useState('');

  if (isLead) {
    return (
      <p className="text-[12px] text-muted">
        A Warden routes work but doesn&apos;t take jobs, so it has no patron cut. Stake on a
        Wright in this Ward instead.
      </p>
    );
  }

  if (!b.configured) {
    return (
      <p className="text-[12px] text-muted">
        Patronage isn&apos;t live on this network yet. Staking opens once the contracts are
        deployed.
      </p>
    );
  }

  const fmt = (n: bigint, maxFraction = 2) =>
    formatWageUnits(n, { decimals: b.decimals, maxFraction });
  const exact = (n: bigint) => formatWageExact(n, b.decimals);

  const parsed = parseWageInput(amountText, b.decimals);
  const amount = parsed.ok ? parsed.value : 0n;
  const typed = amountText.trim() !== '';

  // Alasan penolakan hanya ditampilkan setelah user mengetik sesuatu.
  let problem: string | null = null;
  if (typed) {
    if (!parsed.ok) problem = parsed.error;
    else if (mode === 'stake') {
      problem = checkStake({
        amount,
        balance: b.balance,
        staked: b.staked,
        minStake: b.minStake,
        maxStakePerUser: b.maxStakePerUser,
        registered: b.registered,
        paused: b.paused,
        decimals: b.decimals,
      });
    } else {
      problem = checkUnstake({ amount, staked: b.staked, decimals: b.decimals });
    }
  }

  const canTransact = b.connected && !b.wrongNetwork && b.ready && b.userReady && !!b.token;
  const needsApproval = mode === 'stake' && parsed.ok && b.allowance < amount;
  const canSubmit = canTransact && !actions.busy && typed && parsed.ok && problem === null;

  const maxAmount =
    mode === 'stake' ? maxStakeable(b.balance, b.staked, b.maxStakePerUser) : b.staked;

  const sharePct = b.poolStaked > 0n ? Number((b.staked * 10_000n) / b.poolStaked) / 100 : 0;

  async function submit() {
    if (!canSubmit || !b.token) return;
    const ok =
      mode === 'stake'
        ? await actions.stake(amount, b.token)
        : await actions.requestUnstake(amount);
    if (ok) setAmountText('');
  }

  const submitLabel =
    mode === 'stake'
      ? needsApproval
        ? 'Approve & stake'
        : `Stake ${WAGE_TOKEN}`
      : PATRONAGE_LABEL.requestUnstake;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-muted">
        Stake {WAGE_TOKEN} on this building to share its {WAGE_SPLIT.patronsPct}% patron cut, pro
        rata, every time a client sets the seal.
      </p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
        <span>
          Pool{' '}
          <span className="font-mono text-text" title={b.ready ? exact(b.poolStaked) : undefined}>
            {b.ready ? fmt(b.poolStaked) : '…'}
          </span>
        </span>
        {b.ready && b.cooldownSeconds > 0 && (
          <span>
            Unstake cooldown{' '}
            <span className="font-mono text-text">{describeCooldown(b.cooldownSeconds)}</span>
          </span>
        )}
      </div>

      {b.loadFailed && (
        <div className="flex items-center gap-2 text-[11.5px] text-crit">
          <span>Couldn&apos;t read the Patronage contract.</span>
          <Button size="small" onClick={() => void b.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {b.ready && !b.registered && (
        <p className="text-[11.5px] text-faint">
          This building isn&apos;t open for new stakes. Existing positions can still claim, unstake
          and withdraw.
        </p>
      )}
      {b.ready && b.paused && (
        <p className="text-[11.5px] text-warn">
          New stakes are paused. Claiming, unstaking and withdrawing still work.
        </p>
      )}

      {/* ---- gerbang wallet / jaringan ---- */}
      {!b.connected && (
        <div className="flex flex-wrap items-center gap-2">
          <ConnectWalletButton />
          <span className="text-[11.5px] text-faint">to stake, claim or withdraw.</span>
        </div>
      )}
      {b.connected && b.wrongNetwork && (
        <div className="flex flex-col items-start gap-1.5">
          <p className="text-[11.5px] text-warn">
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
      )}

      {/* ---- posisi wallet ---- */}
      {b.connected && !b.wrongNetwork && (
        <>
          {!b.userReady || !b.ready ? (
            <p className="text-[11.5px] text-faint">Reading your position…</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <Stat label={PATRONAGE_LABEL.staked} value={fmt(b.staked)} title={exact(b.staked)}>
                  {b.staked > 0n && (
                    <span className="text-[11px] text-muted">
                      {sharePct.toLocaleString('en-US', { maximumFractionDigits: 1 })}% of pool
                    </span>
                  )}
                </Stat>
                <Stat
                  label={PATRONAGE_LABEL.pendingRewards}
                  value={fmt(b.pending, 4)}
                  title={exact(b.pending)}
                  gold
                >
                  <button
                    type="button"
                    disabled={actions.busy || b.pending === 0n}
                    onClick={() => void actions.claim()}
                    className="w-fit text-left text-[11px] text-gold underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:text-faint disabled:no-underline"
                  >
                    {PATRONAGE_LABEL.claim}
                  </button>
                </Stat>
              </div>

              {b.cooling > 0n && (
                <CoolingRow
                  cooling={b.cooling}
                  unlockAt={b.unlockAt}
                  decimals={b.decimals}
                  disabled={actions.busy}
                  onWithdraw={() => void actions.withdraw()}
                />
              )}

              <div
                role="group"
                aria-label="Stake or unstake"
                className="flex w-fit overflow-hidden rounded-md border border-line text-[11.5px]"
              >
                {(['stake', 'unstake'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    disabled={actions.busy}
                    onClick={() => {
                      setMode(m);
                      setAmountText('');
                    }}
                    className={`px-2.5 py-1 transition-colors ${
                      mode === m ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                    }`}
                  >
                    {m === 'stake' ? 'Stake' : 'Unstake'}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submit();
                    }}
                    placeholder="100"
                    aria-label={`Amount of ${WAGE_TOKEN} to ${mode}`}
                    aria-invalid={problem !== null}
                    disabled={actions.busy}
                    className="w-full rounded-md border border-line bg-bg py-1.5 pl-2.5 pr-12 text-sm text-text outline-none focus-visible:border-gold"
                  />
                  <button
                    type="button"
                    disabled={actions.busy || maxAmount === 0n}
                    onClick={() => setAmountText(toInputString(maxAmount, b.decimals))}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10.5px] uppercase tracking-wider text-gold hover:bg-surface-2 disabled:text-faint"
                  >
                    Max
                  </button>
                </div>
                <Button
                  size="small"
                  variant={mode === 'stake' ? 'primary' : 'default'}
                  disabled={!canSubmit}
                  onClick={() => void submit()}
                  className="shrink-0"
                >
                  {submitLabel}
                </Button>
              </div>

              <p className="text-[11px] text-faint">
                {PATRONAGE_LABEL.walletBalance}{' '}
                <span className="font-mono text-muted" title={exact(b.balance)}>
                  {fmt(b.balance)}
                </span>
                {needsApproval && ' · Two wallet prompts: approve, then stake.'}
              </p>
              {problem && <p className="text-[11.5px] text-warn">{problem}</p>}
            </div>
          )}
        </>
      )}

      <TxStatus tx={actions.tx} onDismiss={actions.reset} />

      <p className="text-[11px] text-faint">
        Rewards come from wages that clients actually seal, so they depend on how much work this
        building does. $WAGE in cooldown earns nothing.
        {patronageAddress && (
          <>
            {' '}
            <a
              href={explorerAddress(patronageAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-text"
            >
              Contract ↗
            </a>
          </>
        )}
      </p>
    </div>
  );
}

/** Baris Bond: WAGE yang dikunci bangunan, slashed kalau kalah sengketa. */
export function BondLine({ bondWage }: { bondWage: number }) {
  return (
    <p className="text-[12px] text-muted">
      Bond: <span className="font-mono text-text">{formatWage(bondWage)}</span> locked by
      this building. Slashed if it loses a dispute.
    </p>
  );
}
