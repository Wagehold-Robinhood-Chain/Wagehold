'use client';

import { WAGE_UNIT, formatWage } from '@/lib/currency';
import { useWageBalance } from '@/lib/web3/use-wage-balance';
import { usePatronBuildings } from '@/lib/web3/use-patron-buildings';
import { useOnchainPools } from '@/components/patronage/use-onchain-pools';
import { useEffect, useMemo, useState } from 'react';
import { CityScene, type CityAgent } from '@/components/city-scene';
import { useCityChainSignals } from '@/components/weighhouse/use-work-ratio';
import { StatBar } from '@/components/stat-bar';
import { WrightProfilePanel } from '@/components/wright-profile-panel';
import {
  deriveAgentStats,
  deriveRank,
  deriveWardStats,
} from '@/lib/agent-stats';
import { JobBoard, type JobBoardItem } from '@/components/job-board';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { SiteNav } from '@/components/site-nav';
import { SiteLogo } from '@/components/site-logo';
import { WalletConnect } from '@/components/wallet-connect';
import { useRealtimeChanges } from '@/lib/supabase/realtime';
import { useIdentity } from '@/lib/identity/use-identity';
import { isWalletMode } from '@/lib/identity/mode';
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
  code: string;
  district: DistrictId;
  rank: Rank;
  isLead: boolean;
  description: string;
  /** WAGE yang dikunci bangunan ini (agents.bond_wage). */
  bondWage: number;
  rating: number | null;
  jobsSealed: number;
  revenue30d: number;
}

interface WageTotals {
  /** Total yang dibakar di Furnace (wage_splits.furnace). */
  burned: number;
  /** Counting House: tithe + reward yang dialihkan ke treasury, dari chain (0020). null = belum terbaca. */
  treasury: number | null;
}

/** Counting House dipolling dari `/api/counting-house` (event on-chain yang sudah diindeks). */
const COUNTING_HOUSE_POLL_MS = 60_000;

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
  /** Rating 1-5 dari client saat set-the-seal (0007_job_rating.sql), null
   *  kalau belum di-rate. Dipakai deriveAgentStats() untuk Client rating. */
  rating: number | null;
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
  initialTotals,
  initialUserId,
}: {
  initialAgents: DashboardAgent[];
  initialJobs: DashboardJob[];
  initialEvents: DashboardEvent[];
  initialTotals: WageTotals;
  initialUserId: string | null;
}) {
  const [agents, setAgents] = useState(initialAgents);
  const [jobs, setJobs] = useState(initialJobs);
  const [events, setEvents] = useState(initialEvents);
  const [totals, setTotals] = useState(initialTotals);
  // Wright yang profilnya tampil di panel kiri -- default: revenue tertinggi
  // (listAgents mengurutkan revenue_30d menurun). Diganti lewat klik gedung.
  const [selectedId, setSelectedId] = useState<string | null>(
    initialAgents[0]?.id ?? null,
  );
  const userId = useIdentity(initialUserId);
  const walletBalance = useWageBalance();
  // Cincin emas (§8.3): bangunan yang di-stake wallet yang terhubung, dibaca langsung dari kontrak.
  const patronIds = usePatronBuildings(initialAgents.map((a) => a.id));
  // Stake dan jumlah patron per bangunan (stat bar profil) dari indexer on-chain.
  const onchainPools = useOnchainPools();
  // Kilau jendela landmark Weighhouse mengikuti Work Ratio 24 jam.
  const { workRatioPct: workRatio24h, burnPulse } = useCityChainSignals();

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
      rating: row.rating,
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
              bondWage: Number(row.bond_wage ?? a.bondWage),
              rating: row.rating == null ? null : Number(row.rating),
              jobsSealed: row.jobs_sealed,
            }
          : a,
      ),
    );
  });

  // Furnace: satu baris wage_splits per job yang disegel. Counting House BUKAN dari sini (lihat bawah).
  useRealtimeChanges('wage_splits', (payload) => {
    if (payload.eventType !== 'INSERT') return;
    const row = payload.new;
    setTotals((prev) => ({ ...prev, burned: prev.burned + Number(row.furnace) }));
  });

  // Counting House (tithe + reward yang dialihkan) dari event on-chain: dipolling, dilewati saat tab
  // tersembunyi. Bacaan gagal mempertahankan angka terakhir (tidak berkedip jadi 0).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch('/api/counting-house');
        if (!r.ok) return;
        const json = (await r.json()) as { total?: number };
        if (cancelled || typeof json.total !== 'number') return;
        const total = json.total;
        setTotals((prev) => ({ ...prev, treasury: total }));
      } catch {
        /* diam: stat bar tetap pada nilai terakhir */
      }
    };
    // Sekali saat mount (murah, di-cache 30 dtk di edge): menutup kasus server gagal membaca saat render.
    void load();
    const id = setInterval(() => void load(), COUNTING_HOUSE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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

  // Sealed jobs, revenue & rating per agent dari job `paid` sungguhan (lihat
  // lib/agent-stats.ts) -- dipakai untuk tinggi gedung dan Wright profile,
  // bukan lagi agents.revenue_30d / jobs_sealed / rating (angka demo seed).
  const statsByAgent = useMemo(() => {
    const map = new Map<
      string,
      { jobsSealed: number; revenue30d: number; rating: number | null }
    >();
    for (const a of agents) {
      map.set(a.id, deriveAgentStats(jobs.filter((j) => j.agentId === a.id)));
    }
    return map;
  }, [agents, jobs]);

  // Statistik per Ward -- dipakai untuk profil Warden DAN tinggi gedung
  // Warden. Warden tidak pernah punya job sendiri (selectWright() melewati
  // is_lead), jadi angkanya diwakili seluruh Ward (lihat deriveWardStats).
  // Tinggi gedung memakai angka yang sama dengan Revenue 30D di profilnya,
  // supaya gedung Warden ikut naik setiap Wright di Ward-nya kena seal.
  const statsByDistrict = useMemo(() => {
    const map = new Map<
      DistrictId,
      { jobsSealed: number; revenue30d: number; rating: number | null }
    >();
    const districts = new Set(agents.map((a) => a.district));
    for (const d of districts) {
      map.set(d, deriveWardStats(jobs.filter((j) => j.district === d)));
    }
    return map;
  }, [agents, jobs]);

  const cityAgents: CityAgent[] = useMemo(
    () =>
      agents.map((a) => ({
        id: a.id,
        code: a.code,
        district: a.district,
        // Warden: akumulasi seluruh Ward (sama dengan Revenue 30D di profil);
        // Wright: job miliknya sendiri.
        revenue30d: a.isLead
          ? (statsByDistrict.get(a.district)?.revenue30d ?? 0)
          : (statsByAgent.get(a.id)?.revenue30d ?? 0),
        status: statusByAgent.get(a.id) ?? 'idle',
      })),
    [agents, statsByAgent, statsByDistrict, statusByAgent],
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

  // Furnace dari wage_splits (dicatat record_wage_split saat seal); Counting House dari chain (/api/counting-house).

  const agentCodes = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agents) map[a.id] = a.code;
    return map;
  }, [agents]);

  // Job Board (kolom kanan) -- gerbang seal (Article I): hanya pemilik job
  // (wallet / browser) yang melihat "Set the seal" / "Send back". Keputusan sesungguhnya
  // tetap di server (Route Handler approve/revise), ini cuma memilih tombol yang tampil.
  const boardItems: JobBoardItem[] = useMemo(
    () =>
      jobs.map((j) => ({
        job: {
          id: j.id,
          title: j.title,
          district: j.district,
          agentCode: j.agentId ? agentCodes[j.agentId] : undefined,
          budgetUsdc: j.budgetUsdc,
          status: j.status,
          progress: j.progress,
          escrowTx: j.escrowTx,
        },
        isOwnJob: !!userId && j.clientId === userId,
      })),
    [jobs, agentCodes, userId],
  );

  // Wright profile (kolom kiri) -- diturunkan dari agents + jobs yang sudah ada di state.
  const selectedAgent: AgentDetail | null = useMemo(() => {
    const a = agents.find((x) => x.id === selectedId);
    if (!a) return null;
    // Sealed jobs, revenue & rating dihitung dari baris `jobs` yang benar-benar
    // ada di database, supaya angkanya cocok dengan daftar Sealed jobs di
    // bawahnya dan dengan tinggi gedungnya di kota (kolom agents.* masih demo).
    const ownStats = statsByAgent.get(a.id) ?? {
      jobsSealed: 0,
      revenue30d: 0,
      rating: null,
    };
    // Stake & jumlah patron: on-chain (indexer).
    const pool = onchainPools.get(a.id) ?? { stakerCount: 0, stakedWage: 0 };
    // Warden: agregat seluruh Ward, bukan job miliknya sendiri (selalu 0).
    const stats = a.isLead
      ? (statsByDistrict.get(a.district) ?? ownStats)
      : ownStats;
    return {
      id: a.id,
      name: a.name,
      code: a.code,
      district: a.district,
      // Fase 3 item 3: rank dari sealed jobs + rating sungguhan (lihat
      // catatan di lib/agent-stats.ts) -- Warden tetap dari a.rank/isLead.
      rank: a.isLead ? a.rank : deriveRank(stats.jobsSealed, stats.rating),
      isLead: a.isLead,
      status: statusByAgent.get(a.id) ?? 'idle',
      revenue30d: stats.revenue30d,
      description: a.description,
      stakerCount: pool.stakerCount,
      stakedWage: pool.stakedWage,
      bondWage: a.bondWage,
      rating: stats.rating,
      jobsSealed: stats.jobsSealed,
    };
  }, [
    agents,
    selectedId,
    statsByAgent,
    statsByDistrict,
    statusByAgent,
    onchainPools,
  ]);

  const toSummary = (j: DashboardJob, code: string): JobSummary => ({
    id: j.id,
    title: j.title,
    district: j.district,
    agentCode: code,
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
    return active ? toSummary(active, selectedAgent.code) : null;
  }, [jobs, selectedAgent]);

  const sealedJobs: JobSummary[] = useMemo(() => {
    if (!selectedAgent) return [];
    // Warden: daftar Sealed jobs = seluruh Ward (cocok dengan angka agregat
    // di atasnya), tiap baris memakai code Wright yang mengerjakannya.
    const belongs = (j: DashboardJob) =>
      selectedAgent.isLead
        ? j.district === selectedAgent.district && j.agentId != null
        : j.agentId === selectedAgent.id;
    return jobs
      .filter((j) => belongs(j) && j.status === 'paid')
      .slice(0, 5)
      .map((j) =>
        toSummary(
          j,
          (j.agentId ? agentCodes[j.agentId] : undefined) ??
            selectedAgent.code,
        ),
      );
  }, [jobs, selectedAgent, agentCodes]);

  const jobTitleById = useMemo(
    () => new Map(jobs.map((j) => [j.id, j.title])),
    [jobs],
  );

  const ledgerEvents: LedgerEvent[] = useMemo(() => {
    const shared: LedgerEvent[] = events.map((e) => ({
      id: e.id,
      at: e.at,
      // Judul job diisi bebas oleh user -> WAJIB di-escape (LedgerWall merender HTML).
      html: `<b>${escapeHtml(e.actor)}</b> ${escapeHtml(e.note ?? e.type)} -- "${escapeHtml(
        jobTitleById.get(e.jobId) ?? 'a job',
      )}"`,
    }));
    return shared
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, MAX_EVENTS);
  }, [events, jobTitleById]);

  return (
    <MotionPage className="flex h-screen flex-col gap-3 p-3">
      <MotionHeader className="flex flex-wrap items-center gap-3">
        <SiteLogo />
        <SiteNav />
        <p className="hidden text-[13px] italic text-muted sm:block">
          Work sealed. Wages shared.
        </p>
        <StatBar
          stats={[
            {
              label: 'Counting House',
              value:
                totals.treasury === null
                  ? '—'
                  : `${Math.round(totals.treasury).toLocaleString('en-US')} ${WAGE_UNIT}`,
            },
            {
              label: 'In the Strongbox',
              value: `${inStrongbox.toLocaleString('en-US')} ${WAGE_UNIT}`,
              gold: true,
            },
            {
              label: 'Burned in the Furnace',
              value: `${Math.round(totals.burned).toLocaleString('en-US')} ${WAGE_UNIT}`,
              crit: true,
            },
            { label: 'Sealed jobs', value: String(sealedCount) },
            {
              label: 'Wrights at work',
              value: `${wrightsAtWork} / ${cityAgents.length}`,
            },
            // Hanya kalau wallet terhubung dan saldonya terbaca (mode wallet).
            ...(walletBalance !== null
              ? [
                  {
                    label: 'Your wallet',
                    value: formatWage(walletBalance),
                  },
                ]
              : []),
          ]}
        />
        <WalletConnect />
      </MotionHeader>

      {/* 3 kolom seperti prototipe: Wright profile | The City | Job Board.
          Di layar sempit ditumpuk vertikal dan halamannya bisa di-scroll. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)_380px] lg:overflow-visible lg:[grid-template-rows:minmax(0,1fr)]">
        <WrightProfilePanel
          agent={selectedAgent}
          currentJob={currentJob}
          sealedJobs={sealedJobs}
          viewerId={initialUserId}
          className="h-[520px] lg:h-full"
        />

        <Panel className="h-[520px] lg:h-full">
          <PanelHeader
            title="The City"
            action={
              <span className="text-[11.5px] text-faint">
                drag to rotate · scroll to zoom
                {patronIds.size > 0 && ' · gold ring: you are a patron here'}
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
                workRatioPct={workRatio24h}
                burnPulse={burnPulse}
                patronIds={patronIds}
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
          <JobBoard items={boardItems} needsWallet={isWalletMode && !userId} />
        </div>
      </div>

      <MotionFooter className="text-center text-[11px] text-faint">
        No coin leaves the Hold without a human seal.
      </MotionFooter>
    </MotionPage>
  );
}
