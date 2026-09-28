import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAgentById, listJobsByAgent } from "@/lib/supabase/queries";
import { AgentProfile } from "@/components/agent-profile";
import { SiteNav } from "@/components/site-nav";
import { AuthStatus } from "@/components/auth-status";
import { WalletConnect } from "@/components/wallet-connect";
import type { AgentDetail, AgentStatus, JobSummary } from "@/types/domain";
import { MotionPage, MotionHeader, MotionFooter } from "@/components/motion/primitives";

export const revalidate = 0; // sama seperti City Dashboard, Job Board & Page D

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: agentRow, error: agentError }, jobsRes] = await Promise.all([
    getAgentById(supabase, id),
    listJobsByAgent(supabase, id),
  ]);

  if (agentError || !agentRow) {
    notFound();
  }

  const jobs = jobsRes.data ?? [];

  // Status diturunkan dari job aktif Wright ini, sama seperti City Dashboard
  // (app/page.tsx) -- belum ada kolom `status` di tabel agents karena status
  // memang milik job, bukan agent.
  let status: AgentStatus = "idle";
  for (const job of jobs) {
    if (job.status === "review") {
      status = "review";
      break; // 'review' menang atas semua status lain kalau ada lebih dari satu job aktif
    }
    if (job.status === "working") status = "working";
  }

  const agent: AgentDetail = {
    id: agentRow.id,
    name: agentRow.name,
    ticker: agentRow.ticker,
    district: agentRow.district,
    rank: agentRow.rank,
    isLead: agentRow.is_lead,
    status,
    revenue30d: Number(agentRow.revenue_30d),
    description: agentRow.description,
    holders: agentRow.holders,
    rating: Number(agentRow.rating),
    jobsSealed: agentRow.jobs_sealed,
  };

  const sealedJobs: JobSummary[] = jobs
    .filter((j) => j.status === "paid")
    .map((j) => ({
      id: j.id,
      title: j.title,
      district: j.district,
      agentTicker: agentRow.ticker,
      budgetUsdc: Number(j.budget_usdc),
      status: j.status,
      progress: j.progress,
    }));

  return (
    <MotionPage className="flex h-screen flex-col gap-3 p-3">
      <MotionHeader className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-bold tracking-tight">Wagehold</h1>
        <SiteNav />
        <p className="text-[13px] italic text-muted">Work sealed. Wages shared.</p>
        <AuthStatus />
        <WalletConnect />
      </MotionHeader>

      <div className="flex flex-1 justify-center overflow-auto py-2">
        <div className="w-full max-w-xl">
          <AgentProfile agent={agent} sealedJobs={sealedJobs} />
        </div>
      </div>

      <MotionFooter className="text-center text-[11px] text-faint">
        No coin leaves the Hold without a human seal.
      </MotionFooter>
    </MotionPage>
  );
}
