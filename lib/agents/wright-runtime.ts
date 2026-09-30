import { WAGE_UNIT } from '@/lib/currency';
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
 * (DIVE) yang hidup dan district selain 'research' sengaja tidak
 * disentuh (`if (job.district !== 'research') return;`). File ini menghapus
 * batasan itu: kelima Ward sekarang punya runtime yang sama, dan mana Wright
 * yang mengerjakan job ditentukan oleh selectWright() (item 5), bukan lagi
 * satu code yang di-hardcode.
 */

const ACTIONABLE_STATUSES: JobRow['status'][] = ['open', 'working', 'revision'];

/**
 * Fase 3 item 5 -- "Warden membagi kerja": memilih satu Wright non-Warden
 * di Ward yang sama untuk job baru, bukan selalu Wright pertama/tetap
 * seperti sebelumnya (dulu selalu Deepdive untuk seluruh Research Ward).
 *
 * Kriteria (belum ada spesifikasi persis di brief -- keputusan
 * implementasi, didokumentasikan supaya bisa didebat/diubah):
 *  1. Paling sedikit job yang belum disegel ('working' + 'review' +
 *     'revision') dulu -- job yang menunggu seal client tetap dihitung
 *     beban, karena Wright-nya belum "bebas" dari job itu. (Dulu hanya
 *     'working' yang dihitung; karena job selesai dalam hitungan detik dan
 *     langsung pindah ke 'review', semua Wright selalu terlihat idle.)
 *  2. Kalau seri, yang paling sedikit total job-nya menang -- round-robin
 *     sederhana supaya giliran bergantian, bukan selalu Wright yang sama.
 *  3. Kalau masih seri, rank tertinggi (lihat deriveRank, item 3) menang.
 *  4. Kalau masih seri, yang paling lama tidak dapat job menang; terakhir
 *     code alfabetis sebagai tie-break yang stabil.
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
    .select('agent_id, status, budget_usdc, rating, created_at')
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
    // Job yang belum disegel = masih jadi tanggungan Wright ini.
    const activeCount = agentJobs.filter(
      (j) =>
        j.status === 'working' ||
        j.status === 'review' ||
        j.status === 'revision',
    ).length;
    const totalCount = agentJobs.length;
    const lastAssignedAt = agentJobs.reduce(
      (max, j) => Math.max(max, Date.parse(j.created_at) || 0),
      0,
    );
    const stats = deriveAgentStats(
      agentJobs.map((j) => ({
        status: j.status,
        budgetUsdc: Number(j.budget_usdc),
        rating: j.rating,
      })),
    );
    const rank = deriveRank(stats.jobsSealed, stats.rating);
    return {
      agent,
      activeCount,
      totalCount,
      lastAssignedAt,
      rankWeight: RANK_WEIGHT[rank],
    };
  });

  scored.sort((a, b) => {
    if (a.activeCount !== b.activeCount) return a.activeCount - b.activeCount;
    if (a.totalCount !== b.totalCount) return a.totalCount - b.totalCount;
    if (a.rankWeight !== b.rankWeight) return b.rankWeight - a.rankWeight;
    if (a.lastAssignedAt !== b.lastAssignedAt)
      return a.lastAssignedAt - b.lastAssignedAt;
    return a.agent.code.localeCompare(b.agent.code);
  });

  return scored[0].agent;
}

/** Dipakai kalau `agents.system_prompt` masih kosong (mis. migrasi 0003/0008
 *  belum jalan) -- supaya fitur tetap jalan (dengan kualitas lebih rendah)
 *  daripada gagal total karena kolom belum terisi. Generik per Wright/Ward,
 *  bukan lagi hardcode teks Deepdive seperti versi lama file ini. */
function fallbackSystemPrompt(agent: AgentRow, district: DistrictId): string {
  return `You are ${agent.name} (${agent.code}), a Wright of the ${WARD_LABEL[district]} inside Wagehold, a walled city of AI workers whose motto is "Work sealed. Wages shared." Write a clear, well-structured response to the brief given, in line with your Ward's craft. Flag uncertainty instead of inventing facts, and never give buy/sell financial advice.`;
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
  // Hire langsung dari Gate (?agent=): job masih 'open' tapi sudah punya Wright pilihan
  // client -- Warden tidak me-routing, langsung dikerjakan Wright itu.
  const hired = !!job.agent_id && job.status === 'open';

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
    agent = await wardenSelects(supabase, jobId, job.district);
  }

  if (!agent) {
    await logEvent(
      supabase,
      jobId,
      'system',
      'error',
      `No Wright is available in the ${WARD_LABEL[job.district]} yet -- check that the seed migration (0002) has run.`,
    );
    await setProgress(supabase, jobId, 0);
    return;
  }

  if (!job.agent_id || hired) {
    await supabase
      .from('jobs')
      .update({ agent_id: agent.id, status: 'working', progress: 15 })
      .eq('id', jobId);
    await logEvent(
      supabase,
      jobId,
      agent.name,
      'assigned',
      hired
        ? `You hired ${agent.name} (${agent.code}) directly for this brief.`
        : `The ${WARD_LABEL[job.district]} sends this brief to ${agent.name} (${agent.code}).`,
    );
  } else {
    await supabase
      .from('jobs')
      .update({ status: 'working', progress: 30 })
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

  await setProgress(supabase, jobId, 30);
  await logEvent(
    supabase,
    jobId,
    agent.name,
    'reading_brief',
    `${agent.name} is reading the brief${isRevision ? ' and your revision notes' : ''}.`,
  );
  await setProgress(supabase, jobId, 45);
  await logEvent(
    supabase,
    jobId,
    agent.name,
    'drafting',
    `${agent.name} is drafting the ${isRevision ? 'revised ' : ''}report.`,
  );

  // Progres jalan berdasarkan waktu (45% -> 90%) selama Wright "bekerja",
  // supaya client sempat melihat tahapannya bergerak. Kalau Gemini selesai
  // lebih cepat dari MIN_WORK_MS, sisa waktunya ditunggu dulu (lihat di
  // bawah) -- ini pacing tampilan, bukan kerja tambahan. Atur lewat env
  // WRIGHT_MIN_WORK_MS (0 = tanpa jeda). Tetap di bawah maxDuration 60 detik.
  const minWorkMs = Number(process.env.WRIGHT_MIN_WORK_MS ?? 35_000);
  const workStartedAt = Date.now();
  let checkingLogged = false;
  const targetProgress = () =>
    minWorkMs > 0
      ? 45 +
        Math.floor(45 * Math.min(1, (Date.now() - workStartedAt) / minWorkMs))
      : 90;

  let current = 45;
  const tick = async () => {
    const next = Math.max(current, Math.min(90, targetProgress()));
    if (next === current) return;
    current = next;
    await setProgress(supabase, jobId, current);
    if (current >= 70 && !checkingLogged) {
      checkingLogged = true;
      await logEvent(
        supabase,
        jobId,
        agent.name,
        'checking',
        `${agent.name} is checking the draft against the brief.`,
      );
    }
  };
  const heartbeat = setInterval(() => void tick(), 2_000);

  try {
    const { text } = await callGemini(systemPrompt, userPrompt, {
      model: agent.model,
    });
    // Gemini cepat selesai? Tunggu sisa waktu kerja sambil progres terus naik.
    const remaining = minWorkMs - (Date.now() - workStartedAt);
    if (remaining > 0) await sleep(remaining);
    clearInterval(heartbeat);
    await tick();

    await setProgress(supabase, jobId, 95);
    await logEvent(
      supabase,
      jobId,
      agent.name,
      'finalizing',
      `${agent.name} is finishing up and attaching the deliverable.`,
    );

    await supabase
      .from('jobs')
      .update({ status: 'review', progress: 100, deliverable: text })
      .eq('id', jobId);

    await logEvent(
      supabase,
      jobId,
      agent.name,
      'submitted',
      `${agent.name} delivered the report. Review the deliverable, then set the seal or send it back.`,
    );
  } catch (err) {
    clearInterval(heartbeat);
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
  let prompt = `Job title: ${job.title}\nBudget: ${job.budget_usdc} ${WAGE_UNIT}\n\nClient brief:\n${job.brief}`;
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

/** Update progress job (dipantau live lewat Supabase Realtime di Job Detail
 *  dan Job Board). Tidak pernah melempar -- progres hanyalah informasi. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fase seleksi: Warden "memilih" Wright selama WARDEN_SELECT_MS (default
 *  30 detik, 0 = langsung). Job tetap 'open' -- progress 0->14 dan event di
 *  Ledger membuat client melihat prosesnya. Wright baru dipilih di AKHIR
 *  fase ini (bukan di awal) supaya hitungan beban/giliran sudah memuat job
 *  lain yang di-assign selama menunggu. */
async function wardenSelects(
  supabase: ServiceClient,
  jobId: string,
  district: DistrictId,
): Promise<AgentRow | null> {
  const totalMs = Number(process.env.WARDEN_SELECT_MS ?? 30_000);
  const actor = `${WARD_LABEL[district]} Warden`;

  if (totalMs > 0) {
    const steps: { at: number; progress: number; note: string }[] = [
      {
        at: 0,
        progress: 2,
        note: `The ${WARD_LABEL[district]} Warden is reading the brief and choosing a Wright.`,
      },
      {
        at: 0.33,
        progress: 7,
        note: 'Checking which Wrights are free and comparing their track records.',
      },
      {
        at: 0.66,
        progress: 12,
        note: 'Narrowing down the candidates.',
      },
    ];
    const startedAt = Date.now();
    for (const step of steps) {
      const wait = step.at * totalMs - (Date.now() - startedAt);
      if (wait > 0) await sleep(wait);
      await setProgress(supabase, jobId, step.progress);
      await logEvent(supabase, jobId, actor, 'selecting', step.note);
    }
    const rest = totalMs - (Date.now() - startedAt);
    if (rest > 0) await sleep(rest);
  }

  return selectWright(supabase, district);
}

async function setProgress(
  supabase: ServiceClient,
  jobId: string,
  progress: number,
) {
  await supabase.from('jobs').update({ progress }).eq('id', jobId);
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
