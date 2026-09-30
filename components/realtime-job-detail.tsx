'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  JobDetail,
  type JobDetailEvent,
  type JobAgentInfo,
} from '@/components/job-detail';
import { SiteNav } from '@/components/site-nav';
import { WalletConnect } from '@/components/wallet-connect';
import { useRealtimeChanges } from '@/lib/supabase/realtime';
import { useIdentity } from '@/lib/identity/use-identity';
import { isWalletMode } from '@/lib/identity/mode';
import type { DistrictId, JobStatus, JobSummary } from '@/types/domain';
import {
  MotionPage,
  MotionHeader,
  MotionFooter,
} from '@/components/motion/primitives';

/**
 * Item 11 (Realtime Ledger Wall): halaman Job Detail sekarang mendengar
 * baris job ini saja (`jobs`, filter `id=eq.<jobId>`) dan event-nya
 * (`job_events`, filter `job_id=eq.<jobId>`) lewat Supabase Realtime.
 * Ini yang langsung menjawab keluhan checklist Fase 1 item 11: client yang
 * sedang membuka halaman job Research Ward-nya melihat status bergerak dari
 * `open` -> `working` -> `review`, progress bar bergerak, dan panel
 * Deliverable muncul begitu Deepdive selesai lewat Gemini -- tanpa refresh
 * manual, walau prosesnya berjalan di request `POST /api/jobs` yang lain.
 */
export function RealtimeJobDetail({
  jobId,
  title,
  district,
  agentCode,
  budgetUsdc,
  brief,
  agent,
  initialStatus,
  initialProgress,
  initialDeliverable,
  escrowTx,
  initialEvents,
  clientId,
  initialUserId,
}: {
  jobId: string;
  title: string;
  district: DistrictId;
  agentCode?: string;
  budgetUsdc: number;
  brief: string;
  agent: JobAgentInfo | null;
  initialStatus: JobStatus;
  initialProgress: number;
  initialDeliverable: string | null;
  escrowTx: string | null;
  initialEvents: JobDetailEvent[];
  clientId: string;
  initialUserId: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [progress, setProgress] = useState(initialProgress);
  const [deliverable, setDeliverable] = useState(initialDeliverable);
  const [events, setEvents] = useState(initialEvents);
  const userId = useIdentity(initialUserId);
  const router = useRouter();
  // Wright baru ditugaskan Warden SETELAH halaman ini terbuka (Post a job langsung
  // redirect ke sini). Nama/kode/rank Wright datang dari render server, bukan dari
  // payload Realtime -- jadi begitu agent_id berubah, minta server render ulang.
  // Tanpa ini kartu Job tidak punya kode Wright, sehingga kotak rating tidak muncul
  // dan panel Wright hilang sampai halaman di-refresh manual.
  const agentIdRef = useRef<string | null>(agent?.id ?? null);

  useRealtimeChanges(
    'jobs',
    (payload) => {
      if (payload.eventType === 'DELETE') return;
      const row = payload.new;
      setStatus(row.status);
      setProgress(row.progress);
      setDeliverable(row.deliverable);
      if (row.agent_id && row.agent_id !== agentIdRef.current) {
        agentIdRef.current = row.agent_id;
        router.refresh();
      }
    },
    `id=eq.${jobId}`,
  );

  useRealtimeChanges(
    'job_events',
    (payload) => {
      if (payload.eventType !== 'INSERT') return; // event tidak pernah di-update/dihapus
      const row = payload.new;
      setEvents((prev) => {
        if (prev.some((e) => e.id === row.id)) return prev; // guard kalau event yang sama masuk dobel
        return [
          ...prev,
          {
            id: row.id,
            actorLabel: row.actor,
            text: row.note ?? row.type,
            tx: row.tx,
            // Diformat di browser -- baris ini tidak pernah ikut SSR
            // (baru muncul lewat WebSocket), jadi tidak ada risiko
            // hydration mismatch seperti events awal dari server.
            atLabel: new Date(row.at).toLocaleString('en-US', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          },
        ];
      });
    },
    `job_id=eq.${jobId}`,
  );

  const summary: JobSummary = {
    id: jobId,
    title,
    district,
    agentCode,
    budgetUsdc,
    status,
    progress,
    escrowTx,
  };

  return (
    <MotionPage className="flex h-screen flex-col gap-3 p-3">
      <MotionHeader className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-bold tracking-tight">
          Wagehold
        </h1>
        <SiteNav />
        <p className="hidden text-[13px] italic text-muted sm:block">
          Work sealed. Wages shared.
        </p>
        <WalletConnect />
      </MotionHeader>

      <div className="flex flex-1 justify-center overflow-auto py-2">
        <div className="w-full max-w-6xl">
          <JobDetail
            job={summary}
            brief={brief}
            deliverable={deliverable}
            agent={agent}
            events={events}
            isOwnJob={!!userId && clientId === userId}
            needsWallet={isWalletMode && !userId}
          />
        </div>
      </div>

      <MotionFooter className="text-center text-[11px] text-faint">
        No coin leaves the Hold without a human seal.
      </MotionFooter>
    </MotionPage>
  );
}
