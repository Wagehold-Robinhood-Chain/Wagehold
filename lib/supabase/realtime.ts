"use client";

import { useEffect, useMemo, useRef } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type TableName = keyof Database["public"]["Tables"];
type Row<T extends TableName> = Database["public"]["Tables"][T]["Row"];

/**
 * Berlangganan perubahan Postgres lewat Supabase Realtime (WebSocket) --
 * Fase 1 item 11, pengganti polling manual (`revalidate = 0` di server +
 * `router.refresh()` di client) yang dipakai City Dashboard, Job Board dan
 * Job Detail sebelum ini.
 *
 * Butuh tabelnya sudah masuk publication `supabase_realtime` (lihat
 * `supabase/migrations/0004_realtime_ledger.sql`). RLS tetap berlaku --
 * subscription lewat anon key hanya menerima baris yang boleh dibaca client
 * itu lewat policy SELECT yang sama seperti query biasa.
 *
 * @param table   nama tabel Postgres (`agents` | `jobs` | `job_events`)
 * @param onChange dipanggil untuk tiap INSERT/UPDATE/DELETE yang lolos filter
 * @param filter  filter opsional gaya PostgREST, mis. `job_id=eq.${id}` --
 *                dipakai Job Detail supaya cuma dengar event job itu sendiri
 */
export function useRealtimeChanges<T extends TableName>(
  table: T,
  onChange: (payload: RealtimePostgresChangesPayload<Row<T>>) => void,
  filter?: string
) {
  const supabase = useMemo(() => createClient(), []);

  // Callback disimpan lewat ref, bukan dependency effect -- supaya parent
  // yang re-render dengan closure baru (state ledger/jobs berubah tiap
  // event masuk) tidak memicu unsubscribe/subscribe ulang ke channel.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange; // diperbarui setelah render (bukan saat render)
  });

  useEffect(() => {
    const channel = supabase
      .channel(`db-changes:${table}:${filter ?? "all"}`)
      .on<Row<T>>(
        "postgres_changes",
        filter
          ? { event: "*", schema: "public", table, filter }
          : { event: "*", schema: "public", table },
        (payload) => onChangeRef.current(payload)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, table, filter]);
}
