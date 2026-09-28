'use client';

import { useMemo, useState } from 'react';
import { CityScene, type CityAgent } from '@/components/city-scene';
import { StatBar } from '@/components/stat-bar';
import { WrightProfilePanel } from '@/components/wright-profile-panel';
import { JobBoard, type JobBoardItem } from '@/components/job-board';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SiteNav } from '@/components/site-nav';
import { AuthStatus } from '@/components/auth-status';
import { WalletConnect } from '@/components/wallet-connect';
import { useRealtimeChanges } from '@/lib/supabase/realtime';
import { useCurrentUserId } from '@/lib/supabase/use-current-user-id';
import { escapeHtml } from '@/lib/escape-html';
import type {
  AgentDetail,
  AgentStatus,
  DistrictId,
  JobStatus,
  JobSummary,
  LedgerEvent,
  Rank,
} from '@/types/domain';
import {
  MotionPage,
  MotionHeader,
  MotionFooter,
} from '@/components/motion/primitives';

interface DashboardAgent {
  id: string;
  name: string;
  ticker: string;
  district: DistrictId;
  rank: Rank;
  isLead: boolean;
  description: string;
  holders: number;
  rating: number;
  jobsSealed: number;
  revenue30d: number;
}

interface DashboardJob {
  id: string;
  title: string;
  district: DistrictId;
  agentId: string | null;
  status: JobStatus;
  budgetUsdc: number;
  progress: number;
  clientId: string;
  /** Tx hash escrow on-chain -- dipakai Set the seal untuk memilih alur wallet vs simulasi. */
  escrowTx: string | null;
}

interface DashboardEvent {
  id: string;
  jobId: string;
  at: string;
  actor: string;
  type: string;
  note: string | null;
}

// Ledger Wall cuma menampilkan 20 baris terakhir (sama seperti
// listRecentEvents sebelumnya) -- dijaga di sini juga supaya array event
// tidak tumbuh tanpa batas selama tab dibiarkan terbuka lama.
const MAX_EVENTS = 20;

/**
 * Item 11 (Realtime Ledger Wall): seluruh City Dashboard sekarang satu
 * Client Component yang mulai dari data hasil render server (`initial*`),
 * lalu didorong Supabase Realtime (WebSocket) tiap ada perubahan di
 * `job_events`, `jobs`, atau `agents` -- pengganti `revalidate = 0` +
 * refresh manual. Tinggi gedung, status Wright (idle/working/review), dan
 * Ledger Wall semuanya ikut bergerak tanpa reload, termasuk saat Deepdive
 * memproses job Research Ward lewat Gemini di request lain.
 */
export function RealtimeCityDashboard({
  initialAgents,
  initialJobs,
  initialEvents,
  initialUserId,
}: {
  initialAgents: DashboardAgent[];
  initialJobs: DashboardJob[];
  initialEvents: DashboardEvent[];
  initialUserId: string | null;
}) {
  const [agents, setAgents] = useState(initialAgents);
  const [jobs, setJobs] = useState(initialJobs);
  const [events, setEvents] = useState(initialEvents);
  // Wright yang profilnya tampil di panel kiri -- default: revenue tertinggi
  // (listAgents mengurutkan revenue_30d menurun). Diganti lewat klik gedung.
  const [selectedId, setSelectedId] = useState<string | null>(
    initialAgents[0]?.id ?? null,
  );
  const userId = useCurrentUserId(initialUserId);

  useRealtimeChanges('job_events', (payload) => {
    if (payload.eventType !== 'INSERT') return; // event tidak pernah di-update/dihapus
    const row = payload.new;
    setEvents((prev) => {
      if (prev.some((e) => e.id === row.id)) return prev; // guard kalau event yang sama masuk dobel
      const next: DashboardEvent = {
        id: row.id,
        jobId: row.job_id,
        at: row.at,
        actor: row.actor,
        type: row.type,
        note: row.note,
      };
      return [next, ...prev]
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
        .slice(0, MAX_EVENTS);
    });
  });

  useRealtimeChanges('jobs', (payload) => {
    if (payload.eventType === 'DELETE') return; // job tidak pernah dihapus lewat alur produk
    const row = payload.new;
    const next: DashboardJob = {
      id: row.id,
      title: row.title,
      district: row.district,
      agentId: row.agent_id,
      status: row.status,
      budgetUsdc: Number(row.budget_usdc),
      progress: row.progress,
      clientId: row.client_id,
      escrowTx: row.escrow_tx,
    };
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === next.id);
      if (idx === -1) return [next, ...prev];
      const copy = prev.slice();
      copy[idx] = next;
      return copy;
    });
  });

  useRealtimeChanges('agents', (payload) => {
    if (payload.eventType !== 'UPDATE') return; // revenue_30d berubah lewat Set the seal
    const row = payload.new;
    setAgents((prev) =>
      prev.map((a) =>
        a.id === row.id
          ? {
              ...a,
              revenue30d: Number(row.revenue_30d),
              holders: row.holders,
              rating: Number(row.rating),
              jobsSealed: row.jobs_sealed,
            }
          : a,
      ),
    );
  });

  // Status per agent diturunkan dari job aktifnya -- belum ada kolom
  // `status` di tabel agents, karena status memang milik job, bukan agent.
  const statusByAgent = useMemo(() => {
    const map = new Map<string, AgentStatus>();
    for (const job of jobs) {
      if (!job.agentId) continue;
      if (job.status !== 'working' && job.status !== 'review') continue;
      const current = map.get(job.agentId);
      if (job.status === 'review' || current !== 'review') {
        map.set(job.agentId, job.status === 'review' ? 'review' : 'working');
      }
    }
    return map;
  }, [jobs]);

  const cityAgents: CityAgent[] = useMemo(
    () =>
      agents.map((a) => ({
        id: a.id,
        ticker: a.ticker,
        district: a.district,
        revenue30d: a.revenue30d,
        status: statusByAgent.get(a.id) ?? 'idle',
      })),
    [agents, statusByAgent],
  );

  const sealedCount = useMemo(
    () => jobs.filter((j) => j.status === 'paid').length,
    [jobs],
  );

  const inStrongbox = useMemo(
    () =>
      jobs
        .filter(
          (j) =>
            j.status === 'open' ||
            j.status === 'working' ||
            j.status === 'review',
        )
        .reduce((sum, j) => sum + j.budgetUsdc, 0),
    [jobs],
  );

  const wrightsAtWork = useMemo(
    () => cityAgents.filter((a) => a.status !== 'idle').length,
    [cityAgents],
  );

  // Treasury belum punya tabel sendiri -- didekati dari 10% tithe yang
  // proporsional terhadap 70% Patron share yang sudah tercatat di revenue_30d.
  // Diganti angka sungguhan begitu ada tabel treasury (Fase 2, GET /treasury).
  const estimatedTithe = useMemo(
    () => agents.reduce((sum, a) => sum + a.revenue30d * (10 / 70), 0),
    [agents],
  );

  const agentTickers = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agents) map[a.id] = a.ticker;
    return map;
  }, [agents]);

  // Job Board (kolom kanan) -- gerbang seal (Article I): hanya client pemilik
  // job yang melihat "Set the seal" / "Send back". Keputusan sesungguhnya tetap
  // di server (Route Handler approve/revise), ini cuma memilih tombol yang tampil.
  const boardItems: JobBoardItem[] = useMemo(
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
        isOwnJob: !!userId && j.clientId === userId,
      })),
    [jobs, agentTickers, userId],
  );

  // Wright profile (kolom kiri) -- diturunkan dari agents + jobs yang sudah ada di state.
  const selectedAgent: AgentDetail | null = useMemo(() => {
    const a = agents.find((x) => x.id === selectedId);
    if (!a) return null;
    return {
      id: a.id,
      name: a.name,
      ticker: a.ticker,
      district: a.district,
      rank: a.rank,
      isLead: a.isLead,
      status: statusByAgent.get(a.id) ?? 'idle',
      revenue30d: a.revenue30d,
      description: a.description,
      holders: a.holders,
      rating: a.rating,
      jobsSealed: a.jobsSealed,
    };
  }, [agents, selectedId, statusByAgent]);

  const toSummary = (j: DashboardJob, ticker: string): JobSummary => ({
    id: j.id,
    title: j.title,
    district: j.district,
    agentTicker: ticker,
    budgetUsdc: j.budgetUsdc,
    status: j.status,
    progress: j.progress,
    escrowTx: j.escrowTx,
  });

  const currentJob: JobSummary | null = useMemo(() => {
    if (!selectedAgent) return null;
    const mine = jobs.filter((j) => j.agentId === selectedAgent.id);
    const active =
      mine.find((j) => j.status === 'review') ??
      mine.find((j) => j.status === 'working');
    return active ? toSummary(active, selectedAgent.ticker) : null;
  }, [jobs, selectedAgent]);

  const sealedJobs: JobSummary[] = useMemo(() => {
    if (!selectedAgent) return [];
    return jobs
      .filter((j) => j.agentId === selectedAgent.id && j.status === 'paid')
      .slice(0, 5)
      .map((j) => toSummary(j, selectedAgent.ticker));
  }, [jobs, selectedAgent]);

  const jobTitleById = useMemo(
    () => new Map(jobs.map((j) => [j.id, j.title])),
    [jobs],
  );

  const ledgerEvents: LedgerEvent[] = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        at: e.at,
        // Judul job diisi bebas oleh user -> WAJIB di-escape (LedgerWall merender HTML).
        html: `<b>${escapeHtml(e.actor)}</b> ${escapeHtml(e.note ?? e.type)} -- "${escapeHtml(
          jobTitleById.get(e.jobId) ?? 'a job',
        )}"`,
      })),
    [events, jobTitleById],
  );

  return (
    <MotionPage className="flex h-screen flex-col gap-3 p-3">
      <MotionHeader className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-bold tracking-tight">
          Wagehold
        </h1>
        <SiteNav />
        <p className="text-[13px] italic text-muted">
          Work sealed. Wages shared.
        </p>
        <StatBar
          stats={[
            {
              label: 'Counting House',
              value: `${Math.round(estimatedTithe).toLocaleString('en-US')} USDC`,
            },
            {
              label: 'In the Strongbox',
              value: `${inStrongbox.toLocaleString('en-US')} USDC`,
              gold: true,
            },
            { label: 'Sealed jobs', value: String(sealedCount) },
            {
              label: 'Wrights at work',
              value: `${wrightsAtWork} / ${cityAgents.length}`,
            },
          ]}
        />
        <AuthStatus />
        <WalletConnect />
      </MotionHeader>

      {/* 3 kolom seperti prototipe: Wright profile | The City | Job Board.
          Di layar sempit ditumpuk vertikal dan halamannya bisa di-scroll. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)_380px] lg:overflow-visible lg:[grid-template-rows:minmax(0,1fr)]">
        <WrightProfilePanel
          agent={selectedAgent}
          currentJob={currentJob}
          sealedJobs={sealedJobs}
          className="h-[520px] lg:h-full"
        />

        <Panel className="h-[520px] lg:h-full">
          <PanelHeader
            title="The City"
            action={
              <span className="text-[11.5px] text-faint">
                drag to rotate · scroll to zoom
              </span>
            }
          />
          <div className="relative min-h-0 flex-1">
            {cityAgents.length === 0 ? (
              <p className="p-4 text-sm text-faint">
                No Wright registered yet -- run
                supabase/migrations/0002_seed_agents.sql.
              </p>
            ) : (
              <CityScene
                agents={cityAgents}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}

            {/* Ledger Wall ringkas: 4 event terbaru menumpuk di dasar kota (seperti prototipe). */}
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex w-[min(70%,460px)] flex-col gap-1">
              {ledgerEvents.slice(0, 4).map((e) => (
                <div
                  key={e.id}
                  className="truncate rounded-md border border-white/[0.08] bg-bg/85 px-2.5 py-1 text-[11.5px] text-muted backdrop-blur-sm [&_b]:font-medium [&_b]:text-text"
                  dangerouslySetInnerHTML={{ __html: e.html }}
                />
              ))}
            </div>
          </div>
        </Panel>

        <div className="h-[520px] min-h-0 lg:h-full">
          <JobBoard items={boardItems} signedIn={!!userId} />
        </div>
      </div>

      <MotionFooter className="text-center text-[11px] text-faint">
        No coin leaves the Hold without a human seal.
      </MotionFooter>
    </MotionPage>
  );
}
