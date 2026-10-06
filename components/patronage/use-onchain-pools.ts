'use client';

import { useEffect, useState } from 'react';
import { baseToWage } from '@/lib/patronage-city';

/**
 * Stake dan jumlah patron per bangunan, dari `/api/patronage/pools` (indexer on-chain; tertinggal beberapa
 * menit dari chain). Dipakai stat bar profil di City Dashboard (Dev Brief §8.3).
 * Satuan WAGE utuh (untuk tampilan). Gagal / belum ada data = Map kosong; pemanggil memakai 0.
 */
export type OnchainPoolStat = { stakerCount: number; stakedWage: number };

const POLL_MS = 60_000;

type PoolsResponse = {
  pools?: { agentId: string; totalStaked: string; patronCount: number }[];
};

export function useOnchainPools(): ReadonlyMap<string, OnchainPoolStat> {
  const [pools, setPools] = useState<ReadonlyMap<string, OnchainPoolStat>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch('/api/patronage/pools');
        if (!r.ok) return; // pertahankan angka terakhir
        const json = (await r.json()) as PoolsResponse;
        if (cancelled || !Array.isArray(json.pools)) return;
        setPools(
          new Map(
            json.pools.map((p) => [
              p.agentId,
              { stakerCount: p.patronCount, stakedWage: baseToWage(p.totalStaked) },
            ]),
          ),
        );
      } catch {
        /* diam: stat bar tetap pada nilai terakhir */
      }
    };
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return pools;
}
