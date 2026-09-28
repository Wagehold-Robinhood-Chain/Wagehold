import { createClient } from "@/lib/supabase/server";
import { listAgents, listJobs, listRecentEvents } from "@/lib/supabase/queries";
import { RealtimeCityDashboard } from "@/components/realtime-city-dashboard";

// Render awal saja -- setelah mount, RealtimeCityDashboard mendengar
// perubahan lewat Supabase Realtime (Item 11), bukan lagi lewat polling.
export const revalidate = 0;

export default async function Home() {
  const supabase = await createClient();

  const [agentsRes, jobsRes, events] = await Promise.all([
    listAgents(supabase),
    listJobs(supabase),
    listRecentEvents(supabase, 20),
  ]);

  const agents = agentsRes.data ?? [];
  const jobs = jobsRes.data ?? [];

  return (
    <RealtimeCityDashboard
      initialAgents={agents.map((a) => ({
        id: a.id,
        ticker: a.ticker,
        district: a.district,
        revenue30d: Number(a.revenue_30d),
      }))}
      initialJobs={jobs.map((j) => ({
        id: j.id,
        title: j.title,
        agentId: j.agent_id,
        status: j.status,
        budgetUsdc: Number(j.budget_usdc),
      }))}
      initialEvents={events.map((e) => ({
        id: e.id,
        jobId: e.job_id,
        at: e.at,
        actor: e.actor,
        type: e.type,
        note: e.note,
      }))}
    />
  );
}
