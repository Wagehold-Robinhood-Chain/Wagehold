import { WAGE_SPLIT, WAGE_UNIT, formatWage } from '@/lib/currency';
import { computeJobId } from '@/lib/web3/strongbox';
import { parseCountingHouse, type CountingHouse } from '@/lib/counting-house';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { DistrictId, JobStatus } from '@/types/enums';

type Client = SupabaseClient<Database>;

// --- Ledger Wall (event lintas job) -------------------------------------

export interface RecentEvent {
  id: string;
  /** Disertakan (bukan cuma job_title) supaya Item 11 (Realtime Ledger Wall)
   *  bisa mencocokkan event baru yang masuk lewat WebSocket -- yang hanya
   *  membawa job_id mentah -- ke job yang sama tanpa query tambahan. */
  job_id: string;
  at: string;
  actor: string;
  type: string;
  note: string | null;
  job_title: string;
}

/** Event terbaru lintas semua job, dipakai Ledger Wall di City Dashboard.
 *  Query 2 langkah (bukan embedded select) dengan alasan yang sama seperti
 *  attachAgentCodes -- types/database.ts belum punya tipe relasi hasil
 *  `supabase gen types`. */
export async function listRecentEvents(
  supabase: Client,
  limit = 20,
): Promise<RecentEvent[]> {
  const { data: events } = await supabase
    .from('job_events')
    .select('*')
    .order('at', { ascending: false })
    .limit(limit);

  if (!events || events.length === 0) return [];

  const jobIds = [...new Set(events.map((e) => e.job_id))];
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, title')
    .in('id', jobIds);
  const titleById = new Map((jobs ?? []).map((j) => [j.id, j.title]));

  return events.map((e) => ({
    id: e.id,
    job_id: e.job_id,
    at: e.at,
    actor: e.actor,
    type: e.type,
    note: e.note,
    job_title: titleById.get(e.job_id) ?? 'a job',
  }));
}

// --- Agents -----------------------------------------------------------

export async function listAgents(supabase: Client) {
  return supabase
    .from('agents')
    .select('*')
    .order('revenue_30d', { ascending: false });
}

export async function getAgentById(supabase: Client, id: string) {
  return supabase.from('agents').select('*').eq('id', id).single();
}

/** Total Furnace (dibakar), dijumlahkan dari `wage_splits` (satu baris per job yang disegel, dicatat oleh
 *  record_wage_split). Counting House TIDAK lagi dari tabel ini: lihat getCountingHouse(). */
export async function getBurnedTotal(supabase: Client) {
  const { data } = await supabase.from('wage_splits').select('furnace');
  let burned = 0;
  for (const r of data ?? []) burned += Number(r.furnace);
  return burned;
}

/** Counting House = tithe + bagian patron yang dialihkan ke treasury, dibaca dari event on-chain yang sudah
 *  diindeks (counting_house_totals, 0020). Hanya service role yang boleh memanggilnya, jadi `admin` harus
 *  client service role. Gagal / migrasi 0020 belum jalan -> `null` (UI menampilkan "—", bukan 0). */
export async function getCountingHouse(admin: Client): Promise<CountingHouse | null> {
  const { data, error } = await admin.rpc('counting_house_totals');
  if (error || !data) return null;
  return parseCountingHouse(data);
}

/** Semua job milik satu Wright (agent_id = id), terbaru dulu. Dipakai Page E
 *  (Wright Profile) untuk menurunkan status kerja saat ini (working/review)
 *  dan daftar sealed jobs -- tidak lewat attachAgentCodes karena code-nya
 *  sudah diketahui dari agent yang sama. */
export async function listJobsByAgent(supabase: Client, agentId: string) {
  return supabase
    .from('jobs')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });
}

/** Semua job dalam satu Ward (district), terbaru dulu. Dipakai profil Warden
 *  (Page E) untuk statistik agregat Ward -- Warden sendiri tidak punya job
 *  (lihat deriveWardStats di lib/agent-stats.ts). */
export async function listJobsByDistrict(
  supabase: Client,
  district: DistrictId,
) {
  return supabase
    .from('jobs')
    .select('*')
    .eq('district', district)
    .order('created_at', { ascending: false });
}

/** Semua agent dalam satu Ward -- untuk memetakan agent_id -> code. */
export async function listAgentsByDistrict(
  supabase: Client,
  district: DistrictId,
) {
  return supabase.from('agents').select('*').eq('district', district);
}

// --- Jobs ---------------------------------------------------------------

export async function listJobs(
  supabase: Client,
  statuses?: JobStatus[],
  /** Kalau diisi, hanya job milik client ini (Job Board per akun). */
  clientId?: string,
) {
  let query = supabase
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false });

  if (clientId) {
    query = query.eq('client_id', clientId);
  }

  if (statuses && statuses.length > 0) {
    query = query.in('status', statuses);
  }

  const jobsRes = await query;
  if (jobsRes.error || !jobsRes.data) return jobsRes;

  return { ...jobsRes, data: await attachAgentCodes(supabase, jobsRes.data) };
}

export async function getJobById(supabase: Client, id: string) {
  const jobRes = await supabase.from('jobs').select('*').eq('id', id).single();

  const eventsRes = await supabase
    .from('job_events')
    .select('*')
    .eq('job_id', id)
    .order('at', { ascending: true });

  const [job] = jobRes.data
    ? await attachAgentCodes(supabase, [jobRes.data])
    : [];

  return {
    job: job ?? jobRes.data,
    jobError: jobRes.error,
    events: eventsRes.data ?? [],
    eventsError: eventsRes.error,
  };
}

/** Menempel `agent_code` ke tiap job lewat query terpisah, karena
 *  types/database.ts masih placeholder manual (belum punya tipe relasi
 *  hasil `supabase gen types`) -- select embedded ("*, agents(...)") baru
 *  aman dipakai setelah tipe itu digenerate dari schema sungguhan. */
async function attachAgentCodes<T extends { agent_id: string | null }>(
  supabase: Client,
  jobs: T[],
): Promise<(T & { agent_code: string | null })[]> {
  const agentIds = [
    ...new Set(jobs.map((j) => j.agent_id).filter((id): id is string => !!id)),
  ];
  if (agentIds.length === 0) {
    return jobs.map((j) => ({ ...j, agent_code: null }));
  }

  const { data: agents } = await supabase
    .from('agents')
    .select('id, code')
    .in('id', agentIds);
  const codeById = new Map((agents ?? []).map((a) => [a.id, a.code]));

  return jobs.map((j) => ({
    ...j,
    agent_code: j.agent_id ? (codeById.get(j.agent_id) ?? null) : null,
  }));
}

export interface CreateJobInput {
  /** Fase 2 item 6: kalau diisi, jobId ini SAMA dengan uuid yang sudah
   *  dipakai untuk menghitung `bytes32 jobId` on-chain (lihat
   *  `lib/web3/strongbox.ts` -- `computeJobId`) sebelum baris ini pernah
   *  ditulis. Wajib disertai `escrowTx`, dan pemanggil (app/api/jobs/route.ts)
   *  sudah memverifikasi lock-nya lewat `verifyOnChainLock` sebelum sampai
   *  di sini -- fungsi ini sendiri tidak mengulang verifikasi itu. Kosongkan
   *  (biarkan Postgres pakai `gen_random_uuid()` default) untuk alur simulasi
   *  lama (escrow belum dikonfigurasi di sisi client). */
  id?: string;
  title: string;
  brief: string;
  district: Database['public']['Tables']['jobs']['Row']['district'];
  budgetUsdc: number;
  /** Hire langsung: bangunan (Wright) yang dipilih client. Kosong = Warden yang memilih.
   *  Pemanggil (POST /api/jobs) sudah memastikan Wright ini ada, bukan Warden, dan
   *  berada di `district` yang sama. */
  agentId?: string;
  /** Tx hash `createJob` di WageholdStrongbox -- hanya diisi lewat alur
   *  Fase 2 item 6 (on-chain sungguhan), null di alur simulasi lama. */
  escrowTx?: string;
}

/** Membuat job baru -- Article III Charter: wage masuk sebelum kerja dimulai.
 *  Dua alur: `escrowTx` diisi -> wage sudah benar-benar terkunci on-chain
 *  (Fase 2 item 6, sudah diverifikasi di route handler sebelum sampai sini);
 *  `escrowTx` kosong -> alur simulasi lama (escrow on-chain belum
 *  dikonfigurasi di `.env.local`, lihat `lib/web3/strongbox.ts`). */
export async function createJob(
  /** Client SERVICE ROLE. Sejak 0005_harden_rls.sql, browser tidak boleh menulis
   *  ke `jobs`, jadi insert hanya lewat sini setelah route memverifikasi user. */
  admin: Client,
  clientId: string,
  input: CreateJobInput,
) {
  const jobRes = await admin
    .from('jobs')
    .insert({
      ...(input.id ? { id: input.id } : {}),
      title: input.title,
      brief: input.brief,
      district: input.district,
      budget_usdc: input.budgetUsdc,
      ...(input.agentId ? { agent_id: input.agentId } : {}),
      client_id: clientId,
      escrow_tx: input.escrowTx ?? null,
      // Weighhouse: jobId on-chain, supaya ledger bisa menaut event -> job (0014_weighhouse.sql).
      chain_job_id: input.escrowTx && input.id ? computeJobId(input.id) : null,
      status: 'open',
      progress: 0,
    })
    .select()
    .single();

  if (jobRes.error || !jobRes.data) return jobRes;

  await admin.from('job_events').insert({
    job_id: jobRes.data.id,
    actor: 'client',
    type: 'job_created',
    note: input.escrowTx
      ? `Wage of ${input.budgetUsdc} ${WAGE_UNIT} locked in the Strongbox on-chain.`
      : `Wage of ${input.budgetUsdc} ${WAGE_UNIT} locked in the Strongbox (simulated -- escrow on-chain belum dikonfigurasi)`,
    tx: input.escrowTx ?? null,
  });

  return jobRes;
}

/** Opsi untuk job yang wage-nya terkunci on-chain (Fase 2 item 7). */
export interface ApproveOnChainOptions {
  /** Tx hash `WageholdStrongbox.approve` dari wallet client -- dicatat di
   *  event Ledger. Boleh kosong kalau seal sudah terjadi di chain tapi
   *  pencatatannya gagal sebelumnya (retry). Pemanggil sudah memverifikasi
   *  status `Released` lewat `verifyReleased` sebelum sampai sini. */
  sealTx?: string;
}

/** Set the seal (Article I): hanya client pemilik job yang boleh approve.
 *  Melepas wage -> status 'paid', kredit demo ke revenue agent (wage kotor,
 *  Revision 1) supaya City Dashboard punya sesuatu untuk ditampilkan.
 *
 *  Tanpa `onChain` (alur simulasi lama) INI BUKAN transaksi atomik dan
 *  wage-nya cuma catatan database. Dengan `onChain` (Fase 2 item 7), wage
 *  sudah benar-benar dilepas di WageholdStrongbox oleh wallet client dan
 *  sudah diverifikasi pemanggil -- fungsi ini hanya mencatat hasilnya. */
export async function approveJob(
  /** Client sesi user -- hanya untuk MEMBACA & mengecek kepemilikan (tunduk RLS). */
  supabase: Client,
  /** Client service role -- satu-satunya yang boleh menulis (lihat 0005_harden_rls.sql). */
  admin: Client,
  jobId: string,
  userId: string,
  onChain?: ApproveOnChainOptions,
  /** Rating 1-5 opsional dari client -- dipakai untuk Client rating Wright
   *  (lib/agent-stats.ts). Tidak wajib: job tetap bisa di-seal tanpa rating. */
  rating?: number,
) {
  const { data: job, error: fetchError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (fetchError || !job) {
    return {
      error: fetchError?.message ?? 'Job not found',
      status: 404 as const,
    };
  }
  if (job.client_id !== userId) {
    return {
      error: 'Only the client who posted this job can set the seal',
      status: 403 as const,
    };
  }
  if (job.status !== 'review') {
    return {
      error: `Job is '${job.status}', not awaiting seal`,
      status: 409 as const,
    };
  }

  // Revenue Wright = wage kotor (lihat lib/agent-stats.ts), bukan porsi patron.
  const grossWage = Number(job.budget_usdc);

  // `.eq("status", "review")` + cek baris terdampak = penjaga atomik: dua request
  // seal bersamaan tidak bisa sama-sama lolos dan mengkredit revenue dua kali.
  const { data: updated, error: updateError } = await admin
    .from('jobs')
    .update({
      status: 'paid',
      progress: 100,
      ...(rating !== undefined ? { rating } : {}),
    })
    .eq('id', jobId)
    .eq('status', 'review')
    .select('id');

  if (updateError) return { error: updateError.message, status: 500 as const };
  if (!updated || updated.length === 0) {
    return { error: 'Job is no longer awaiting seal', status: 409 as const };
  }

  const writer = admin;

  if (job.agent_id) {
    const { data: agent } = await writer
      .from('agents')
      .select('revenue_30d, jobs_sealed')
      .eq('id', job.agent_id)
      .single();

    if (agent) {
      await writer
        .from('agents')
        .update({
          revenue_30d: Number(agent.revenue_30d) + grossWage,
          jobs_sealed: agent.jobs_sealed + 1,
        })
        .eq('id', job.agent_id);
    }
  }

  await writer.from('job_events').insert({
    job_id: jobId,
    actor: 'client',
    type: 'sealed',
    note: onChain
      ? `Set the seal on-chain. ${job.budget_usdc} ${WAGE_UNIT} released from the Strongbox.`
      : `You set the seal on "${job.title}". ${job.budget_usdc} ${WAGE_UNIT} released: ${WAGE_SPLIT.patronsPct}% to patrons, ${WAGE_SPLIT.lampOilPct}% Lamp Oil, ${WAGE_SPLIT.tithePct}% tithe, ${WAGE_SPLIT.furnacePct}% burned.`,
    tx: onChain?.sealTx ?? null,
  });

  // Catat pembagian 60/20/10/10 per job (angka Furnace di kota). Atomik & idempoten di Postgres
  // (record_wage_split). Sejak cut-over (0020) fungsi ini TIDAK lagi membagi ke staker: bagian patron
  // dibagi kontrak (Splitter v2 -> Patronage) dan dibaca dari chain. Kegagalan di sini TIDAK membatalkan
  // seal (job sudah 'paid'); dicatat ke Ledger dan fungsinya aman dipanggil ulang.
  if (job.agent_id) {
    const { data: split, error: splitError } = await writer.rpc(
      'record_wage_split',
      {
        p_job_id: jobId,
        p_patrons_pct: WAGE_SPLIT.patronsPct,
        p_lamp_oil_pct: WAGE_SPLIT.lampOilPct,
        p_tithe_pct: WAGE_SPLIT.tithePct,
        p_furnace_pct: WAGE_SPLIT.furnacePct,
      },
    );

    if (splitError) {
      await writer.from('job_events').insert({
        job_id: jobId,
        actor: 'system',
        type: 'split_record_failed',
        note: `The wage is released, but the split could not be recorded (${splitError.message}).`,
      });
    } else if (split) {
      await writer.from('job_events').insert({
        job_id: jobId,
        actor: 'Furnace',
        type: 'burned',
        note: `${formatWage(split.furnace)} burned in the Furnace.`,
      });
    }
  }

  return { error: null, status: 200 as const };
}

/** Send back (revise): client menolak hasil, job kembali ke 'working'. */
export async function reviseJob(
  /** Client sesi user -- hanya membaca & cek kepemilikan. */
  supabase: Client,
  /** Client service role -- untuk semua penulisan. */
  admin: Client,
  jobId: string,
  userId: string,
  note: string,
) {
  const { data: job, error: fetchError } = await supabase
    .from('jobs')
    .select('client_id, status, district')
    .eq('id', jobId)
    .single();

  if (fetchError || !job) {
    return {
      error: fetchError?.message ?? 'Job not found',
      status: 404 as const,
    };
  }
  if (job.client_id !== userId) {
    return {
      error: 'Only the client who posted this job can send it back',
      status: 403 as const,
    };
  }
  if (job.status !== 'review') {
    return {
      error: `Job is '${job.status}', not awaiting seal`,
      status: 409 as const,
    };
  }

  const { data: updated, error: updateError } = await admin
    .from('jobs')
    .update({ status: 'working' })
    .eq('id', jobId)
    .eq('status', 'review')
    .select('id');

  if (updateError) return { error: updateError.message, status: 500 as const };
  if (!updated || updated.length === 0) {
    return { error: 'Job is no longer awaiting seal', status: 409 as const };
  }

  await admin.from('job_events').insert({
    job_id: jobId,
    actor: 'client',
    type: 'sent_back',
    note,
  });

  // district dikembalikan supaya pemanggil (revise/route.ts) tahu apakah
  // perlu memicu ulang Wright yang benar-benar hidup (Fase 1 item 10) --
  // untuk sekarang cuma Research Ward.
  return { error: null, status: 200 as const, district: job.district };
}
