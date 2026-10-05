'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeChanges } from '@/lib/supabase/realtime';

/** Work Ratio 24 jam (persen) untuk kilau landmark Weighhouse di kota 3D. Mengambil dari endpoint
 *  yang sudah di-cache (s-maxage=30), segar ulang tiap menit dan saat ada event chain baru.
 *  null = belum ada data / API gagal (landmark redup, bukan error). */
export function useCityChainSignals(): { workRatioPct: number | null; burnPulse: number } {
  const [pct, setPct] = useState<number | null>(null);
  // Naik 1 tiap event Burned baru (INSERT) -> kilat merah di Furnace kota 3D.
  const [burnPulse, setBurnPulse] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/weighhouse/summary?window=24h');
      if (!res.ok) return;
      const json = (await res.json()) as { tiles?: { workRatioPct?: number | null } };
      setPct(json.tiles?.workRatioPct ?? null);
    } catch {
      /* diam: landmark tetap pada nilai terakhir */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0); // di luar render sinkron
    const id = setInterval(load, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  // Debounce: banyak event dalam satu blok -> satu fetch.
  // Satu langganan untuk dua keperluan (nama channel Supabase dibuat dari nama tabel, jadi jangan dobel).
  useRealtimeChanges('chain_events', (payload) => {
    if (payload.eventType === 'INSERT' && (payload.new as { event?: string } | null)?.event === 'Burned') {
      setBurnPulse((n) => n + 1);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, 2_000);
  });

  return { workRatioPct: pct, burnPulse };
}

export function useWorkRatio24h(): number | null {
  return useCityChainSignals().workRatioPct;
}
