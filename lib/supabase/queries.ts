import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, JobStatus } from "@/types/database";

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
 *  attachAgentTickers -- types/database.ts belum punya tipe relasi hasil
 *  `supabase gen types`. */
export async function listRecentEvents(supabase: Client, limit = 20): Promise<RecentEvent[]> {
  const { data: events } = await supabase
    .from("job_events")
    .select("*")
    .order("at", { ascending: false })
    .limit(limit);

  if (!events || events.length === 0) return [];

  const jobIds = [...new Set(events.map((e) => e.job_id))];
  const { data: jobs } = await supabase.from("jobs").select("id, title").in("id", jobIds);
  const titleById = new Map((jobs ?? []).map((j) => [j.id, j.title]));

  return events.map((e) => ({
    id: e.id,
    job_id: e.job_id,
    at: e.at,
    actor: e.actor,
    type: e.type,
    note: e.note,
    job_title: titleById.get(e.job_id) ?? "a job",
  }));
}

// --- Agents -----------------------------------------------------------

export async function listAgents(supabase: Client) {
  return supabase.from("agents").select("*").order("revenue_30d", { ascending: false });
}

export async function getAgentById(supabase: Client, id: string) {
  return supabase.from("agents").select("*").eq("id", id).single();
}

/** Semua job milik satu Wright (agent_id = id), terbaru dulu. Dipakai Page E
 *  (Wright Profile) untuk menurunkan status kerja saat ini (working/review)
 *  dan daftar sealed jobs -- tidak lewat attachAgentTickers karena ticker-nya
 *  sudah diketahui dari agent yang sama. */
export async function listJobsByAgent(supabase: Client, agentId: string) {
  return supabase
    .from("jobs")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false });
}

// --- Jobs ---------------------------------------------------------------

export async function listJobs(supabase: Client, statuses?: JobStatus[]) {
  let query = supabase
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false });

  if (statuses && statuses.length > 0) {
    query = query.in("status", statuses);
  }

  const jobsRes = await query;
  if (jobsRes.error || !jobsRes.data) return jobsRes;

  return { ...jobsRes, data: await attachAgentTickers(supabase, jobsRes.data) };
}

export async function getJobById(supabase: Client, id: string) {
  const jobRes = await supabase.from("jobs").select("*").eq("id", id).single();

  const eventsRes = await supabase
    .from("job_events")
    .select("*")
    .eq("job_id", id)
    .order("at", { ascending: true });

  const [job] = jobRes.data ? await attachAgentTickers(supabase, [jobRes.data]) : [];

  return {
    job: job ?? jobRes.data,
    jobError: jobRes.error,
    events: eventsRes.data ?? [],
    eventsError: eventsRes.error,
  };
}

/** Menempel `agent_ticker` ke tiap job lewat query terpisah, karena
 *  types/database.ts masih placeholder manual (belum punya tipe relasi
 *  hasil `supabase gen types`) -- select embedded ("*, agents(...)") baru
 *  aman dipakai setelah tipe itu digenerate dari schema sungguhan. */
async function attachAgentTickers<T extends { agent_id: string | null }>(
  supabase: Client,
  jobs: T[]
): Promise<(T & { agent_ticker: string | null })[]> {
  const agentIds = [...new Set(jobs.map((j) => j.agent_id).filter((id): id is string => !!id))];
  if (agentIds.length === 0) {
    return jobs.map((j) => ({ ...j, agent_ticker: null }));
  }

  const { data: agents } = await supabase.from("agents").select("id, ticker").in("id", agentIds);
  const tickerById = new Map((agents ?? []).map((a) => [a.id, a.ticker]));

  return jobs.map((j) => ({
    ...j,
    agent_ticker: j.agent_id ? tickerById.get(j.agent_id) ?? null : null,
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
  district: Database["public"]["Tables"]["jobs"]["Row"]["district"];
  budgetUsdc: number;
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
  input: CreateJobInput
) {
  const jobRes = await admin
    .from("jobs")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      title: input.title,
      brief: input.brief,
      district: input.district,
      budget_usdc: input.budgetUsdc,
      client_id: clientId,
      escrow_tx: input.escrowTx ?? null,
      status: "open",
      progress: 0,
    })
    .select()
    .single();

  if (jobRes.error || !jobRes.data) return jobRes;

  await admin.from("job_events").insert({
    job_id: jobRes.data.id,
    actor: "client",
    type: "job_created",
    note: input.escrowTx
      ? `Wage of ${input.budgetUsdc} USDC locked in the Strongbox on-chain.`
      : `Wage of ${input.budgetUsdc} USDC locked in the Strongbox (simulated -- escrow on-chain belum dikonfigurasi)`,
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
 *  Melepas wage -> status 'paid', kredit demo ke revenue agent (70% Patron
 *  share) supaya City Dashboard punya sesuatu untuk ditampilkan.
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
  onChain?: ApproveOnChainOptions
) {
  const { data: job, error: fetchError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (fetchError || !job) {
    return { error: fetchError?.message ?? "Job not found", status: 404 as const };
  }
  if (job.client_id !== userId) {
    return { error: "Only the client who posted this job can set the seal", status: 403 as const };
  }
  if (job.status !== "review") {
    return { error: `Job is '${job.status}', not awaiting seal`, status: 409 as const };
  }

  const patronShare = Math.round(job.budget_usdc * 0.7 * 100) / 100;

  // `.eq("status", "review")` + cek baris terdampak = penjaga atomik: dua request
  // seal bersamaan tidak bisa sama-sama lolos dan mengkredit revenue dua kali.
  const { data: updated, error: updateError } = await admin
    .from("jobs")
    .update({ status: "paid", progress: 100 })
    .eq("id", jobId)
    .eq("status", "review")
    .select("id");

  if (updateError) return { error: updateError.message, status: 500 as const };
  if (!updated || updated.length === 0) {
    return { error: "Job is no longer awaiting seal", status: 409 as const };
  }

  const writer = admin;

  if (job.agent_id) {
    const { data: agent } = await writer
      .from("agents")
      .select("revenue_30d, jobs_sealed")
      .eq("id", job.agent_id)
      .single();

    if (agent) {
      await writer
        .from("agents")
        .update({
          revenue_30d: Number(agent.revenue_30d) + patronShare,
          jobs_sealed: agent.jobs_sealed + 1,
        })
        .eq("id", job.agent_id);
    }
  }

  await writer.from("job_events").insert({
    job_id: jobId,
    actor: "client",
    type: "sealed",
    note: onChain
      ? `Set the seal on-chain. ${job.budget_usdc} USDC released from the Strongbox.`
      : `Set the seal. ${patronShare} USDC released to Patrons.`,
    tx: onChain?.sealTx ?? null,
  });

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
  note: string
) {
  const { data: job, error: fetchError } = await supabase
    .from("jobs")
    .select("client_id, status, district")
    .eq("id", jobId)
    .single();

  if (fetchError || !job) {
    return { error: fetchError?.message ?? "Job not found", status: 404 as const };
  }
  if (job.client_id !== userId) {
    return { error: "Only the client who posted this job can send it back", status: 403 as const };
  }
  if (job.status !== "review") {
    return { error: `Job is '${job.status}', not awaiting seal`, status: 409 as const };
  }

  const { data: updated, error: updateError } = await admin
    .from("jobs")
    .update({ status: "working" })
    .eq("id", jobId)
    .eq("status", "review")
    .select("id");

  if (updateError) return { error: updateError.message, status: 500 as const };
  if (!updated || updated.length === 0) {
    return { error: "Job is no longer awaiting seal", status: 409 as const };
  }

  await admin.from("job_events").insert({
    job_id: jobId,
    actor: "client",
    type: "sent_back",
    note,
  });

  // district dikembalikan supaya pemanggil (revise/route.ts) tahu apakah
  // perlu memicu ulang Wright yang benar-benar hidup (Fase 1 item 10) --
  // untuk sekarang cuma Research Ward.
  return { error: null, status: 200 as const, district: job.district };
}
