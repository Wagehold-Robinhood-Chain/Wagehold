import { WAGE_SYMBOL } from '@/lib/currency';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { callGemini } from '@/lib/agents/gemini';
import { deriveAgentStats, deriveRank, RANK_WEIGHT } from '@/lib/agent-stats';
import { WARD_LABEL } from '@/types/domain';
import type { Database } from '@/types/database';
import type { DistrictId } from '@/types/enums';

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type JobRow = Database['public']['Tables']['jobs']['Row'];
type AgentRow = Database['public']['Tables']['agents']['Row'];

/**
 * Fase 3 item 4 -- generalisasi dari lib/agents/research-wright.ts (Fase 1
 * item 10, sekarang dihapus, digantikan file ini). Waktu itu cuma Deepdive
 * ($DIVE) yang hidup dan district selain 'research' sengaja tidak
 * disentuh (`if (job.district !== 'research') return;`). File ini menghapus
 * batasan itu: kelima Ward sekarang punya runtime yang sama, dan mana Wright
 * yang mengerjakan job ditentukan oleh selectWright() (item 5), bukan lagi
 * satu ticker yang di-hardcode.
 */

const ACTIONABLE_STATUSES: JobRow['status'][] = ['open', 'working', 'revision'];

/**
 * Fase 3 item 5 -- "Warden membagi kerja": memilih satu Wright non-Warden
 * di Ward yang sama untuk job baru, bukan selalu Wright pertama/tetap
 * seperti sebelumnya (dulu selalu Deepdive untuk seluruh Research Ward).
 *
 * Kriteria (belum ada spesifikasi persis di brief -- keputusan
 * implementasi, didokumentasikan supaya bisa didebat/diubah):
 *  1. Paling sedikit job aktif ('working') dulu -- Wright yang paling idle
 *     menang, supaya beban kerja Ward merata, bukan menumpuk di satu Wright.
 *  2. Kalau seri, rank tertinggi (lihat deriveRank, item 3) menang -- brief
 *     yang lebih sulit secara implisit lebih baik ditangani Wright yang
 *     lebih berpengalaman, dan sebaliknya untuk brief yang tidak menuntut,
 *     Wright junior tetap kebagian giliran begitu kriteria 1 menyamakannya.
 *  3. Kalau masih seri (mis. sama-sama Apprentice baru, 0 job), ticker
 *     diurutkan alfabetis -- bukan cuma tie-break yang stabil, tapi juga
 *     supaya hasilnya bisa diprediksi saat ditulis test untuk fungsi ini.
 *
 * Warden ('agents.is_lead = true') SENGAJA tidak pernah dipilih di sini --
 * perannya me-routing (lore), bukan mengerjakan brief sendiri, konsisten
 * dengan catatan yang sudah ada di research-wright.ts versi lama.
 */
export async function selectWright(
  supabase: ServiceClient,
  district: DistrictId,
): Promise<AgentRow | null> {
  const { data: agents } = await supabase
    .from('agents')
    .select('*')
    .eq('district', district)
    .eq('is_lead', false);

  if (!agents || agents.length === 0) return null;
  if (agents.length === 1) return agents[0];

  // Satu query untuk seluruh Ward -- cukup kecil (4 Wright/Ward) untuk tidak
  // perlu di-batch per agent, dan hasilnya dipakai dua kali (beban aktif +
  // rank turunan) tanpa query tambahan per Wright.
  const { data: wardJobs } = await supabase
    .from('jobs')
    .select('agent_id, status, budget_usdc, rating')
    .eq('district', district);

  const jobsByAgent = new Map<string, typeof wardJobs>();
  for (const j of wardJobs ?? []) {
    if (!j.agent_id) continue;
    const list = jobsByAgent.get(j.agent_id) ?? [];
    list.push(j);
    jobsByAgent.set(j.agent_id, list);
  }

  const scored = agents.map((agent) => {
    const agentJobs = jobsByAgent.get(agent.id) ?? [];
    const activeCount = agentJobs.filter((j) => j.status === 'working').length;
    const stats = deriveAgentStats(
      agentJobs.map((j) => ({
        status: j.status,
        budgetUsdc: Number(j.budget_usdc),
        rating: j.rating,
      })),
    );
    const rank = deriveRank(stats.jobsSealed, stats.rating);
    return { agent, activeCount, rankWeight: RANK_WEIGHT[rank] };
  });

  scored.sort((a, b) => {
    if (a.activeCount !== b.activeCount) return a.activeCount - b.activeCount;
    if (a.rankWeight !== b.rankWeight) return b.rankWeight - a.rankWeight;
    return a.agent.ticker.localeCompare(b.agent.ticker);
  });

  return scored[0].agent;
}

/** Dipakai kalau `agents.system_prompt` masih kosong (mis. migrasi 0003/0008
 *  belum jalan) -- supaya fitur tetap jalan (dengan kualitas lebih rendah)
 *  daripada gagal total karena kolom belum terisi. Generik per Wright/Ward,
 *  bukan lagi hardcode teks Deepdive seperti versi lama file ini. */
function fallbackSystemPrompt(agent: AgentRow, district: DistrictId): string {
  return `You are ${agent.name} ($${agent.ticker}), a Wright of the ${WARD_LABEL[district]} inside Wagehold, a walled city of AI workers whose motto is "Work sealed. Wages shared." Write a clear, well-structured response to the brief given, in line with your Ward's craft. Flag uncertainty instead of inventing facts, and never give buy/sell financial advice.`;
}

/**
 * Memproses satu job lewat Gemini, dari assignment sampai job siap disegel
 * ("review") -- atau mencatat kegagalannya ke Ledger Wall dan mengembalikan
 * job ke status aman kalau Gemini gagal dijawab. Menggantikan
 * `runResearchJob` (Fase 1 item 10) -- sekarang berlaku untuk kelima Ward,
 * bukan cuma Research.
 *
 * Dipanggil dari:
 *  - POST /api/jobs, setelah job baru dibuat
 *  - POST /api/jobs/:id/revise, setelah client "Send back" (revisi ulang)
 *
 * Sengaja tidak pernah melempar error ke pemanggilnya -- kegagalan Gemini
 * bukan kegagalan membuat/merevisi job itu sendiri (wage tetap aman di
 * Strongbox, Charter I), jadi selalu ditangani dan dicatat di sini.
 */
export async function runWardJob(jobId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: job } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single();
  if (!job) return;
  if (!ACTIONABLE_STATUSES.includes(job.status)) return;

  const isRevision = job.status === 'working' && !!job.agent_id;

  let agent: AgentRow | null = null;
  if (job.agent_id) {
    // Revisi ("Send back") -- Wright yang sama yang mengerjakan ulang,
    // Warden tidak me-routing ulang job yang sudah punya pemilik.
    const { data } = await supabase
      .from('agents')
      .select('*')
      .eq('id', job.agent_id)
      .single();
    agent = data;
  } else {
    agent = await selectWright(supabase, job.district);
  }

  if (!agent) {
    await logEvent(
      supabase,
      jobId,
      'system',
      'error',
      `No Wright is available in the ${WARD_LABEL[job.district]} yet -- check that the seed migration (0002) has run.`,
    );
    return;
  }

  if (!job.agent_id) {
    await supabase
      .from('jobs')
      .update({ agent_id: agent.id, status: 'working', progress: 35 })
      .eq('id', jobId);
    await logEvent(
      supabase,
      jobId,
      agent.name,
      'assigned',
      `The ${WARD_LABEL[job.district]} sends this brief to ${agent.name} ($${agent.ticker}).`,
    );
  } else {
    await supabase
      .from('jobs')
      .update({ status: 'working', progress: 60 })
      .eq('id', jobId);
    if (isRevision) {
      await logEvent(
        supabase,
        jobId,
        agent.name,
        'revision_started',
        `${agent.name} is reworking the brief with your notes.`,
      );
    }
  }

  const revisionNote = isRevision
    ? await latestRevisionNote(supabase, jobId)
    : null;
  const systemPrompt =
    agent.system_prompt?.trim() || fallbackSystemPrompt(agent, job.district);
  const userPrompt = buildUserPrompt(job, revisionNote);

  try {
    const { text } = await callGemini(systemPrompt, userPrompt, {
      model: agent.model,
    });

    await supabase
      .from('jobs')
      .update({ status: 'review', progress: 100, deliverable: text })
      .eq('id', jobId);

    await logEvent(
      supabase,
      jobId,
      agent.name,
      'submitted',
      `${agent.name} delivered the report. Awaiting your seal.`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';

    // Kembalikan ke 'open' -- bukan macet di 'working' -- supaya jelas untuk
    // client bahwa tidak ada progres tersembunyi, dan wage-nya tetap utuh.
    await supabase
      .from('jobs')
      .update({ status: 'open', progress: 0 })
      .eq('id', jobId);
    await logEvent(
      supabase,
      jobId,
      'system',
      'error',
      `${agent.name} could not finish the brief (${message}). The wage stays safe in the Strongbox -- send the job back or repost it to try again.`,
    );
  }
}

function buildUserPrompt(
  job: Pick<JobRow, 'title' | 'brief' | 'budget_usdc'>,
  revisionNote: string | null,
): string {
  let prompt = `Job title: ${job.title}\nBudget: ${job.budget_usdc} ${WAGE_SYMBOL}\n\nClient brief:\n${job.brief}`;
  if (revisionNote) {
    prompt += `\n\nThe client sent this back with the following note. Revise your report to address it directly:\n${revisionNote}`;
  }
  return prompt;
}

async function latestRevisionNote(
  supabase: ServiceClient,
  jobId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('job_events')
    .select('note')
    .eq('job_id', jobId)
    .eq('type', 'sent_back')
    .order('at', { ascending: false })
    .limit(1);

  return data?.[0]?.note ?? null;
}

async function logEvent(
  supabase: ServiceClient,
  jobId: string,
  actor: string,
  type: string,
  note: string,
) {
  await supabase
    .from('job_events')
    .insert({ job_id: jobId, actor, type, note });
}

export type { AgentRow };
