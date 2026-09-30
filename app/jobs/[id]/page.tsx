import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getInitialUserId } from '@/lib/identity/server';
import {
  getJobById,
  getAgentById,
  listJobsByAgent,
} from '@/lib/supabase/queries';
import { deriveAgentStats, deriveRank } from '@/lib/agent-stats';
import { RealtimeJobDetail } from '@/components/realtime-job-detail';
import type { JobAgentInfo, JobDetailEvent } from '@/components/job-detail';

// Render awal saja -- setelah mount, RealtimeJobDetail mendengar perubahan
// job ini dan Ledger-nya lewat Supabase Realtime (Item 11), bukan lagi
// lewat `router.refresh()` manual sehabis Set the seal / Send back, dan
// tidak perlu direfresh untuk melihat Deepdive bergerak dari open -> review.
export const revalidate = 0;

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [initialUserId, { job, jobError, events }] = await Promise.all([
    getInitialUserId(),
    getJobById(supabase, id),
  ]);

  if (jobError || !job) {
    notFound();
  }

  // Job hanya menyimpan agent_id -- ambil profil Wright terpisah supaya
  // bisa tampilkan nama & rank, bukan cuma code (attachAgentCodes di
  // queries.ts sengaja minimal, lihat catatannya di sana).
  let agent: JobAgentInfo | null = null;
  if (job.agent_id) {
    const { data } = await getAgentById(supabase, job.agent_id);
    if (data) {
      // Fase 3 item 3: rank sama seperti Wright Profile & City Dashboard --
      // dari sealed jobs + rating sungguhan Wright ini, bukan agents.rank.
      let rank = data.rank;
      if (!data.is_lead) {
        const { data: agentJobs } = await listJobsByAgent(supabase, data.id);
        const stats = deriveAgentStats(
          (agentJobs ?? []).map((j) => ({
            status: j.status,
            budgetUsdc: Number(j.budget_usdc),
            rating: j.rating,
          })),
        );
        rank = deriveRank(stats.jobsSealed, stats.rating);
      }
      agent = { id: data.id, name: data.name, code: data.code, rank };
    }
  }

  // Diformat di server supaya render awal tidak berisiko hydration
  // mismatch antara locale/timezone server vs browser. Event yang datang
  // belakangan lewat Realtime diformat di browser (lihat
  // realtime-job-detail.tsx) -- baris itu memang tidak pernah ikut SSR.
  const eventList: JobDetailEvent[] = events.map((e) => ({
    id: e.id,
    actorLabel: e.actor,
    text: e.note ?? e.type,
    tx: e.tx,
    atLabel: new Date(e.at).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
  }));

  return (
    <RealtimeJobDetail
      jobId={job.id}
      title={job.title}
      district={job.district}
      agentCode={agent?.code}
      budgetUsdc={Number(job.budget_usdc)}
      brief={job.brief}
      agent={agent}
      initialStatus={job.status}
      initialProgress={job.progress}
      initialDeliverable={job.deliverable}
      escrowTx={job.escrow_tx}
      initialEvents={eventList}
      clientId={job.client_id}
      initialUserId={initialUserId}
    />
  );
}
