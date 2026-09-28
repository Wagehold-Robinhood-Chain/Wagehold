"use client";

import { useMemo, useState } from "react";
import { CityScene, type CityAgent } from "@/components/city-scene";
import { StatBar } from "@/components/stat-bar";
import { LedgerWall } from "@/components/ledger-wall";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { SiteNav } from "@/components/site-nav";
import { AuthStatus } from "@/components/auth-status";
import { WalletConnect } from "@/components/wallet-connect";
import { useRealtimeChanges } from "@/lib/supabase/realtime";
import { escapeHtml } from "@/lib/escape-html";
import type { AgentStatus, DistrictId, JobStatus, LedgerEvent } from "@/types/domain";
import { MotionPage, MotionHeader, MotionFooter } from "@/components/motion/primitives";

interface DashboardAgent {
  id: string;
  ticker: string;
  district: DistrictId;
  revenue30d: number;
}

interface DashboardJob {
  id: string;
  title: string;
  agentId: string | null;
  status: JobStatus;
  budgetUsdc: number;
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
}: {
  initialAgents: DashboardAgent[];
  initialJobs: DashboardJob[];
  initialEvents: DashboardEvent[];
}) {
  const [agents, setAgents] = useState(initialAgents);
  const [jobs, setJobs] = useState(initialJobs);
  const [events, setEvents] = useState(initialEvents);

  useRealtimeChanges("job_events", (payload) => {
    if (payload.eventType !== "INSERT") return; // event tidak pernah di-update/dihapus
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

  useRealtimeChanges("jobs", (payload) => {
    if (payload.eventType === "DELETE") return; // job tidak pernah dihapus lewat alur produk
    const row = payload.new;
    const next: DashboardJob = {
      id: row.id,
      title: row.title,
      agentId: row.agent_id,
      status: row.status,
      budgetUsdc: Number(row.budget_usdc),
    };
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === next.id);
      if (idx === -1) return [next, ...prev];
      const copy = prev.slice();
      copy[idx] = next;
      return copy;
    });
  });

  useRealtimeChanges("agents", (payload) => {
    if (payload.eventType !== "UPDATE") return; // revenue_30d berubah lewat Set the seal
    const row = payload.new;
    setAgents((prev) =>
      prev.map((a) => (a.id === row.id ? { ...a, revenue30d: Number(row.revenue_30d) } : a))
    );
  });

  // Status per agent diturunkan dari job aktifnya -- belum ada kolom
  // `status` di tabel agents, karena status memang milik job, bukan agent.
  const statusByAgent = useMemo(() => {
    const map = new Map<string, AgentStatus>();
    for (const job of jobs) {
      if (!job.agentId) continue;
      if (job.status !== "working" && job.status !== "review") continue;
      const current = map.get(job.agentId);
      if (job.status === "review" || current !== "review") {
        map.set(job.agentId, job.status === "review" ? "review" : "working");
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
        status: statusByAgent.get(a.id) ?? "idle",
      })),
    [agents, statusByAgent]
  );

  const sealedCount = useMemo(() => jobs.filter((j) => j.status === "paid").length, [jobs]);

  const inStrongbox = useMemo(
    () =>
      jobs
        .filter((j) => j.status === "open" || j.status === "working" || j.status === "review")
        .reduce((sum, j) => sum + j.budgetUsdc, 0),
    [jobs]
  );

  const wrightsAtWork = useMemo(
    () => cityAgents.filter((a) => a.status !== "idle").length,
    [cityAgents]
  );

  // Treasury belum punya tabel sendiri -- didekati dari 10% tithe yang
  // proporsional terhadap 70% Patron share yang sudah tercatat di revenue_30d.
  // Diganti angka sungguhan begitu ada tabel treasury (Fase 2, GET /treasury).
  const estimatedTithe = useMemo(
    () => agents.reduce((sum, a) => sum + a.revenue30d * (10 / 70), 0),
    [agents]
  );

  const jobTitleById = useMemo(() => new Map(jobs.map((j) => [j.id, j.title])), [jobs]);

  const ledgerEvents: LedgerEvent[] = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        at: e.at,
        // Judul job diisi bebas oleh user -> WAJIB di-escape (LedgerWall merender HTML).
        html: `<b>${escapeHtml(e.actor)}</b> ${escapeHtml(e.note ?? e.type)} -- "${escapeHtml(
          jobTitleById.get(e.jobId) ?? "a job"
        )}"`,
      })),
    [events, jobTitleById]
  );

  return (
    <MotionPage className="flex h-screen flex-col gap-3 p-3">
      <MotionHeader className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-bold tracking-tight">Wagehold</h1>
        <SiteNav />
        <p className="text-[13px] italic text-muted">Work sealed. Wages shared.</p>
        <StatBar
          stats={[
            { label: "Counting House", value: `${Math.round(estimatedTithe).toLocaleString("en-US")} USDC` },
            { label: "In the Strongbox", value: `${inStrongbox.toLocaleString("en-US")} USDC`, gold: true },
            { label: "Sealed jobs", value: String(sealedCount) },
            { label: "Wrights at work", value: `${wrightsAtWork} / ${cityAgents.length}` },
          ]}
        />
        <AuthStatus />
        <WalletConnect />
      </MotionHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 [grid-template-rows:minmax(0,1fr)] lg:grid-cols-[1fr_320px]">
        <Panel className="h-full">
          <PanelHeader title="The City" />
          <div className="min-h-0 flex-1">
            {cityAgents.length === 0 ? (
              <p className="p-4 text-sm text-faint">
                No Wright registered yet -- run supabase/migrations/0002_seed_agents.sql.
              </p>
            ) : (
              <CityScene agents={cityAgents} />
            )}
          </div>
        </Panel>

        <LedgerWall events={ledgerEvents} className="h-full" />
      </div>

      <MotionFooter className="text-center text-[11px] text-faint">
        No coin leaves the Hold without a human seal.
      </MotionFooter>
    </MotionPage>
  );
}
