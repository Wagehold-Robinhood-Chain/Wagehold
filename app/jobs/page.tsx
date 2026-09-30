import { createClient } from '@/lib/supabase/server';
import { getInitialUserId } from '@/lib/identity/server';
import { listJobs, listAgents } from '@/lib/supabase/queries';
import { RealtimeJobBoard } from '@/components/realtime-job-board';

// Render awal saja -- setelah mount, RealtimeJobBoard mendengar perubahan
// tabel `jobs` lewat Supabase Realtime (Item 11), bukan lagi lewat
// `router.refresh()` manual sehabis Set the seal / Send back.
export const revalidate = 0;

export default async function JobsPage() {
  const supabase = await createClient();

  // Job Board bersifat per pemilik. Mode simulasi: server tahu id browser ini
  // (cookie) jadi cukup kirim job miliknya. Mode wallet: server tidak tahu wallet
  // mana yang terhubung, jadi kirim semua job (data publik) dan browser yang
  // menyaring lewat useIdentity -- board kosong sampai wallet connect.
  const userId = await getInitialUserId();
  const [jobsRes, agentsRes] = await Promise.all([
    listJobs(supabase, undefined, userId ?? undefined),
    listAgents(supabase),
  ]);

  const rows = jobsRes?.data ?? [];

  // Code Wright tidak pernah berubah, jadi cukup diambil sekali di sini
  // (bukan lewat subscribe tabel `agents`) untuk dicocokkan ke `agent_id`
  // job -- baik yang datang dari render awal maupun lewat Realtime.
  const agentCodes: Record<string, string> = {};
  for (const a of agentsRes.data ?? []) {
    agentCodes[a.id] = a.code;
  }

  return (
    <RealtimeJobBoard
      // key = id browser (mode simulasi) -- board dibangun ulang kalau identitasnya berganti.
      key={userId ?? 'wallet'}
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
      agentCodes={agentCodes}
      initialUserId={userId}
    />
  );
}
