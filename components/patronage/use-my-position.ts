'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PoolView, PositionView } from '@/lib/patronage-onchain';
import { unionBuildingIds } from '@/lib/patronage-page';
import {
  useNetworkGate,
  usePatronageActions,
  usePatronagePositions,
} from '@/lib/web3/use-patronage';

/**
 * Semua yang dibutuhkan halaman /patronage tentang wallet yang terhubung, dalam satu hook supaya
 * panel "Your position" dan kolom "Your stake" di tabel membaca sumber yang sama.
 *
 * - Angka live (stake, cooldown, pending rewards): multicall langsung ke kontrak.
 * - Indexer (`/api/patronage/me`): total yang sudah diklaim, nama bangunan di luar daftar pool,
 *   dan id bangunan yang mungkin belum ada di daftar pool.
 */

export type MeResponse = {
  positions: PositionView[];
  totals: { staked: string; cooling: string; claimedTotal: string };
};

/** Posisi menurut indexer. `data` hanya berisi hasil untuk wallet yang sedang terhubung. */
function useIndexedPositions(wallet: string | undefined, bump: number) {
  const [state, setState] = useState<{ wallet: string; data: MeResponse | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/patronage/me?wallet=${wallet}`);
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as MeResponse;
        if (!cancelled) setState({ wallet, data, failed: false });
      } catch {
        if (!cancelled) {
          setState((prev) => ({ wallet, data: prev?.wallet === wallet ? prev.data : null, failed: true }));
        }
      }
    };
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [wallet, bump]);

  const mine = state && wallet && state.wallet === wallet ? state : null;
  return { data: mine?.data ?? null, failed: mine?.failed ?? false };
}

export interface BuildingInfo {
  name: string;
  agentId: string | null;
  code: string | null;
}

export function useMyPosition(pools: readonly PoolView[]) {
  const gate = useNetworkGate();
  const [bump, setBump] = useState(0);
  const indexed = useIndexedPositions(gate.address, bump);

  const ids = useMemo(
    () =>
      unionBuildingIds(
        pools.map((p) => p.chainAgentId),
        indexed.data?.positions.map((p) => p.chainAgentId) ?? [],
      ),
    [pools, indexed.data],
  );
  const pos = usePatronagePositions(ids);

  const { refetch: refetchPositions } = pos;
  const onSettled = useCallback(async () => {
    await refetchPositions();
    setBump((b) => b + 1);
  }, [refetchPositions]);
  const actions = usePatronageActions({ onSettled });

  const byId = useMemo(() => {
    const m = new Map<string, BuildingInfo>();
    for (const p of indexed.data?.positions ?? []) {
      m.set(p.chainAgentId.toLowerCase(), { name: p.name ?? '', agentId: p.agentId, code: p.code });
    }
    for (const p of pools) {
      m.set(p.chainAgentId.toLowerCase(), { name: p.name, agentId: p.agentId, code: p.code });
    }
    return m;
  }, [pools, indexed.data]);

  return { gate, pos, actions, indexed, byId };
}

export type MyPosition = ReturnType<typeof useMyPosition>;
