'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useIdentity } from '@/lib/identity/use-identity';
import { formatWage } from '@/lib/currency';
import {
  hasSimulationHistory,
  summarizeSimulation,
  type SimStakeRow,
} from '@/lib/simulation-history';

/**
 * "Simulation history" (Dev Brief §7.2): riwayat stake simulasi di bangunan ini, hanya-baca. Sebelum Patronage
 * pindah on-chain, stake hanyalah catatan di database; tabelnya dibekukan saat cut-over (0020).
 * Tersembunyi bila bangunan ini tidak pernah punya stake simulasi, atau bila datanya tidak terbaca.
 * Angka ini bukan posisi on-chain: posisi sebenarnya ada di panel Patronage di atasnya.
 */
export function SimulationHistory({
  agentId,
  initialUserId,
}: {
  agentId: string;
  initialUserId: string | null;
}) {
  const viewerId = useIdentity(initialUserId);
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SimStakeRow[] | null>(null);
  const [frozenAt, setFrozenAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [stakesRes, cutRes] = await Promise.all([
          supabase.from('stakes').select('staker_id, amount, earned').eq('agent_id', agentId),
          supabase.from('patronage_cutover').select('frozen_at').maybeSingle(),
        ]);
        if (cancelled || stakesRes.error) return; // gagal baca = bagian ini tidak tampil
        setRows(stakesRes.data ?? []);
        setFrozenAt(cutRes.data?.frozen_at ?? null);
      } catch {
        /* diam: riwayat hanya pelengkap */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, agentId]);

  const summary = useMemo(() => (rows ? summarizeSimulation(rows, viewerId) : null), [rows, viewerId]);
  if (!summary || !hasSimulationHistory(summary)) return null;

  const frozen = frozenAt ? new Date(frozenAt).toLocaleDateString('en-US', { dateStyle: 'medium' }) : null;

  return (
    <details className="group rounded-md border border-line px-3 py-2 text-[12px] text-muted">
      <summary className="cursor-pointer select-none text-[12px] text-muted hover:text-text">
        Simulation history
        {frozen && <span className="text-faint"> · frozen {frozen}</span>}
      </summary>
      <div className="mt-2 flex flex-col gap-1.5">
        <p>
          Before Patronage moved on-chain, stakes here were database records, not tokens. They are frozen and no
          longer change. Your real position is in the Patronage panel above.
        </p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
          <dt>Simulated stake when frozen</dt>
          <dd className="text-right font-mono tabular-nums text-text">
            {formatWage(summary.staked)} · {summary.patrons} {summary.patrons === 1 ? 'patron' : 'patrons'}
          </dd>
          <dt>Simulated patron rewards shared</dt>
          <dd className="text-right font-mono tabular-nums text-text">{formatWage(summary.earned)}</dd>
          {summary.mine && (
            <>
              <dt>Yours (simulated stake)</dt>
              <dd className="text-right font-mono tabular-nums text-text">{formatWage(summary.mine.staked)}</dd>
              <dt>Yours (simulated rewards)</dt>
              <dd className="text-right font-mono tabular-nums text-text">{formatWage(summary.mine.earned)}</dd>
            </>
          )}
        </dl>
      </div>
    </details>
  );
}
