import { createServiceRoleClient } from "@/lib/supabase/server";
import { callGemini } from "@/lib/agents/gemini";
import type { Database } from "@/types/database";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
type AgentRow = Database["public"]["Tables"]["agents"]["Row"];

/** Satu-satunya Wright yang "hidup" untuk Fase 1 item 10. Lumen Research
 *  (Warden) tetap dicatat sebagai yang me-route secara lore, tapi routing
 *  sungguhan antar Wright baru masuk Fase 3 item 5 -- untuk sekarang semua
 *  job Research Ward jatuh ke Deepdive. */
const RESEARCH_WRIGHT_TICKER = "DIVE";

/** Dipakai kalau migrasi 0003 belum jalan dan agents.system_prompt masih
 *  kosong -- supaya fitur tetap jalan (dengan kualitas lebih rendah)
 *  daripada gagal total karena kolom belum terisi. */
const FALLBACK_SYSTEM_PROMPT = `You are Deepdive ($DIVE), a Journeyman Wright of the Research Ward inside Wagehold, a walled city of AI workers. Write a clear, well-structured due diligence report for the brief given. Flag uncertainty instead of inventing facts, and never give buy/sell financial advice.`;

const ACTIONABLE_STATUSES: JobRow["status"][] = ["open", "working", "revision"];

/**
 * Memproses satu job Research Ward lewat Gemini, dari assignment sampai
 * job siap disegel ("review") -- atau mencatat kegagalannya ke Ledger Wall
 * dan mengembalikan job ke status aman kalau Gemini gagal dijawab.
 *
 * Dipanggil dari:
 *  - POST /api/jobs, setelah job baru dibuat (district === 'research')
 *  - POST /api/jobs/:id/revise, setelah client "Send back" (revisi ulang)
 *
 * Sengaja tidak pernah melempar error ke pemanggilnya -- kegagalan Gemini
 * bukan kegagalan membuat/merevisi job itu sendiri (wage tetap aman di
 * Strongbox, Charter I), jadi selalu ditangani dan dicatat di sini.
 */
export async function runResearchJob(jobId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single();
  if (!job) return;

  // Fase 1 item 10 baru menghidupkan Research Ward. Ward lain (Chain, Craft,
  // Watch, Hearth) menunggu runtime masing-masing di Fase 3 item 4.
  if (job.district !== "research") return;
  if (!ACTIONABLE_STATUSES.includes(job.status)) return;

  const { data: agent } = await supabase
    .from("agents")
    .select("*")
    .eq("ticker", RESEARCH_WRIGHT_TICKER)
    .single();

  if (!agent) {
    await logEvent(
      supabase,
      jobId,
      "system",
      "error",
      `Deepdive ($${RESEARCH_WRIGHT_TICKER}) is not in the roster -- run the seed migration first.`
    );
    return;
  }

  const isRevision = job.status === "working" && !!job.agent_id;

  if (!job.agent_id) {
    await supabase
      .from("jobs")
      .update({ agent_id: agent.id, status: "working", progress: 35 })
      .eq("id", jobId);
    await logEvent(
      supabase,
      jobId,
      agent.name,
      "assigned",
      `The Research Ward sends this brief to ${agent.name} ($${agent.ticker}).`
    );
  } else {
    await supabase.from("jobs").update({ status: "working", progress: 60 }).eq("id", jobId);
    if (isRevision) {
      await logEvent(
        supabase,
        jobId,
        agent.name,
        "revision_started",
        `${agent.name} is reworking the brief with your notes.`
      );
    }
  }

  const revisionNote = isRevision ? await latestRevisionNote(supabase, jobId) : null;
  const systemPrompt = agent.system_prompt?.trim() || FALLBACK_SYSTEM_PROMPT;
  const userPrompt = buildUserPrompt(job, revisionNote);

  try {
    const { text } = await callGemini(systemPrompt, userPrompt, { model: agent.model });

    await supabase
      .from("jobs")
      .update({ status: "review", progress: 100, deliverable: text })
      .eq("id", jobId);

    await logEvent(
      supabase,
      jobId,
      agent.name,
      "submitted",
      `${agent.name} delivered the report. Awaiting your seal.`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";

    // Kembalikan ke 'open' -- bukan macet di 'working' -- supaya jelas untuk
    // client bahwa tidak ada progres tersembunyi, dan wage-nya tetap utuh.
    await supabase.from("jobs").update({ status: "open", progress: 0 }).eq("id", jobId);
    await logEvent(
      supabase,
      jobId,
      "system",
      "error",
      `${agent.name} could not finish the brief (${message}). The wage stays safe in the Strongbox -- send the job back or repost it to try again.`
    );
  }
}

function buildUserPrompt(
  job: Pick<JobRow, "title" | "brief" | "budget_usdc">,
  revisionNote: string | null
): string {
  let prompt = `Job title: ${job.title}\nBudget: ${job.budget_usdc} USDC\n\nClient brief:\n${job.brief}`;
  if (revisionNote) {
    prompt += `\n\nThe client sent this back with the following note. Revise your report to address it directly:\n${revisionNote}`;
  }
  return prompt;
}

async function latestRevisionNote(supabase: ServiceClient, jobId: string): Promise<string | null> {
  const { data } = await supabase
    .from("job_events")
    .select("note")
    .eq("job_id", jobId)
    .eq("type", "sent_back")
    .order("at", { ascending: false })
    .limit(1);

  return data?.[0]?.note ?? null;
}

async function logEvent(
  supabase: ServiceClient,
  jobId: string,
  actor: string,
  type: string,
  note: string
) {
  await supabase.from("job_events").insert({ job_id: jobId, actor, type, note });
}

// Dipakai supaya `agent` di atas tidak perlu re-import type terpisah kalau
// pemanggil lain butuh bentuknya (mis. test).
export type { AgentRow };
