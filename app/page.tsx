import { createClient } from '@/lib/supabase/server';
import { getInitialUserId } from '@/lib/identity/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  getBurnedTotal,
  getCountingHouse,
  listAgents,
  listJobs,
  listRecentEvents,
} from '@/lib/supabase/queries';
import { RealtimeCityDashboard } from '@/components/realtime-city-dashboard';

// Render awal saja -- setelah mount, RealtimeCityDashboard mendengar
// perubahan lewat Supabase Realtime (Item 11), bukan lagi lewat polling.
export const revalidate = 0;

export default async function Home() {
  const supabase = await createClient();

  const [initialUserId, agentsRes, jobsRes, events, burned, countingHouse] =
    await Promise.all([
      getInitialUserId(),
      listAgents(supabase),
      listJobs(supabase),
      listRecentEvents(supabase, 20),
      getBurnedTotal(supabase),
      // Counting House dari chain (0020). Gagal -> null, dashboard menampilkan "—".
      getCountingHouse(createServiceRoleClient()).catch(() => null),
    ]);

  const agents = agentsRes.data ?? [];
  const jobs = jobsRes.data ?? [];

  return (
    <RealtimeCityDashboard
      initialUserId={initialUserId}
      initialAgents={agents.map((a) => ({
        id: a.id,
        name: a.name,
        code: a.code,
        district: a.district,
        rank: a.rank,
        isLead: a.is_lead,
        description: a.description,
        bondWage: Number(a.bond_wage ?? 0),
        rating: a.rating == null ? null : Number(a.rating),
        jobsSealed: a.jobs_sealed,
        revenue30d: Number(a.revenue_30d),
      }))}
      initialJobs={jobs.map((j) => ({
        id: j.id,
        title: j.title,
        district: j.district,
        agentId: j.agent_id,
        budgetUsdc: Number(j.budget_usdc),
        status: j.status,
        progress: j.progress,
        clientId: j.client_id,
        escrowTx: j.escrow_tx,
        rating: j.rating,
      }))}
      initialTotals={{ burned, treasury: countingHouse?.total ?? null }}
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
