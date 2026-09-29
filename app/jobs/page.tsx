import { createClient } from '@/lib/supabase/server';
import { listJobs, listAgents } from '@/lib/supabase/queries';
import { RealtimeJobBoard } from '@/components/realtime-job-board';

// Render awal saja -- setelah mount, RealtimeJobBoard mendengar perubahan
// tabel `jobs` lewat Supabase Realtime (Item 11), bukan lagi lewat
// `router.refresh()` manual sehabis Set the seal / Send back.
export const revalidate = 0;

export default async function JobsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Job Board bersifat per akun: hanya job milik user yang login. Belum
  // login = board kosong (tidak ada job yang ditampilkan secara global).
  const [jobsRes, agentsRes] = await Promise.all([
    user ? listJobs(supabase, undefined, user.id) : null,
    listAgents(supabase),
  ]);

  const rows = jobsRes?.data ?? [];

  // Ticker Wright tidak pernah berubah, jadi cukup diambil sekali di sini
  // (bukan lewat subscribe tabel `agents`) untuk dicocokkan ke `agent_id`
  // job -- baik yang datang dari render awal maupun lewat Realtime.
  const agentTickers: Record<string, string> = {};
  for (const a of agentsRes.data ?? []) {
    agentTickers[a.id] = a.ticker;
  }

  return (
    <RealtimeJobBoard
      // key = id user: ganti akun (sign in/out) -> board dibangun ulang dari
      // data server milik akun itu, tidak membawa state akun sebelumnya.
      key={user?.id ?? 'anon'}
      initialJobs={rows.map((j) => ({
        id: j.id,
        title: j.title,
        district: j.district,
        agentId: j.agent_id,
        budgetUsdc: Number(j.budget_usdc),
        status: j.status,
        progress: j.progress,
        clientId: j.client_id,
        escrowTx: j.escrow_tx,
      }))}
      agentTickers={agentTickers}
      initialUserId={user?.id ?? null}
    />
  );
}
