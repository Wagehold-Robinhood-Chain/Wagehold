"use client";

import { useMemo, useState } from "react";
import { JobBoard, type JobBoardItem } from "@/components/job-board";
import { SiteNav } from "@/components/site-nav";
import { AuthStatus } from "@/components/auth-status";
import { WalletConnect } from "@/components/wallet-connect";
import { useRealtimeChanges } from "@/lib/supabase/realtime";
import { useCurrentUserId } from "@/lib/supabase/use-current-user-id";
import type { DistrictId, JobStatus } from "@/types/domain";
import { MotionPage, MotionHeader, MotionFooter } from "@/components/motion/primitives";

interface RawJob {
  id: string;
  title: string;
  district: DistrictId;
  agentId: string | null;
  budgetUsdc: number;
  status: JobStatus;
  progress: number;
  clientId: string;
  /** Fase 2 item 7: Set the seal butuh tahu apakah wage job ini terkunci
   *  on-chain (escrow_tx terisi) untuk memilih alur wallet vs simulasi. */
  escrowTx: string | null;
}

/**
 * Item 11 (Realtime Ledger Wall): Job Board sekarang mendengar tabel `jobs`
 * lewat Supabase Realtime, jadi job baru (Post a job) dan perubahan status
 * (mis. Deepdive memproses brief Research Ward: open -> working -> review)
 * langsung pindah tab tanpa `router.refresh()` manual -- ini persis keluhan
 * yang dicatat di checklist Fase 1 item 11.
 *
 * `agentTickers` diambil sekali di server (ticker Wright tidak pernah
 * berubah) supaya tidak perlu subscribe tabel `agents` juga di sini.
 * User id dilacak sendiri lewat `useCurrentUserId` (bukan cuma `signedIn`
 * dari server) supaya gerbang seal (`isOwnJob`) tetap benar begitu user
 * sign in/out tanpa bergantung pada urutan `router.refresh()`.
 */
export function RealtimeJobBoard({
  initialJobs,
  agentTickers,
  initialUserId,
}: {
  initialJobs: RawJob[];
  agentTickers: Record<string, string>;
  initialUserId: string | null;
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const userId = useCurrentUserId(initialUserId);

  useRealtimeChanges("jobs", (payload) => {
    if (payload.eventType === "DELETE") return; // job tidak pernah dihapus lewat alur produk
    const row = payload.new;
    const next: RawJob = {
      id: row.id,
      title: row.title,
      district: row.district,
      agentId: row.agent_id,
      budgetUsdc: Number(row.budget_usdc),
      status: row.status,
      progress: row.progress,
      clientId: row.client_id,
      escrowTx: row.escrow_tx,
    };
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === next.id);
      if (idx === -1) return [next, ...prev]; // job baru dari Post a job
      const copy = prev.slice();
      copy[idx] = next;
      return copy;
    });
  });

  const items: JobBoardItem[] = useMemo(
    () =>
      jobs.map((j) => ({
        job: {
          id: j.id,
          title: j.title,
          district: j.district,
          agentTicker: j.agentId ? agentTickers[j.agentId] : undefined,
          budgetUsdc: j.budgetUsdc,
          status: j.status,
          progress: j.progress,
          escrowTx: j.escrowTx,
        },
        // Gerbang seal (Article I): hanya client pemilik job yang melihat
        // "Set the seal" / "Send back" -- keputusan sesungguhnya tetap di
        // server (Route Handler approve/revise mengecek auth.getUser()
        // sendiri), ini cuma menentukan tombol mana yang ditampilkan.
        isOwnJob: !!userId && j.clientId === userId,
      })),
    [jobs, agentTickers, userId]
  );

  return (
    <MotionPage className="flex h-screen flex-col gap-3 p-3">
      <MotionHeader className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-bold tracking-tight">Wagehold</h1>
        <SiteNav />
        <p className="text-[13px] italic text-muted">Work sealed. Wages shared.</p>
        <AuthStatus />
        <WalletConnect />
      </MotionHeader>

      <div className="min-h-0 flex-1">
        <JobBoard items={items} signedIn={!!userId} />
      </div>

      <MotionFooter className="text-center text-[11px] text-faint">
        No coin leaves the Hold without a human seal.
      </MotionFooter>
    </MotionPage>
  );
}
