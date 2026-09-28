import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { reviseJob } from "@/lib/supabase/queries";
import { runResearchJob } from "@/lib/agents/research-wright";

// Deepdive (Gemini) berjalan di dalam request ini -- beri waktu cukup di Vercel.
export const maxDuration = 60;

const MAX_NOTE_LENGTH = 1000;
// Tiap "Send back" memicu satu panggilan Gemini; batasi supaya satu job tidak
// bisa di-loop tanpa akhir untuk menguras kuota.
const MAX_REVISIONS_PER_JOB = 5;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to send this job back" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!note) {
    return NextResponse.json({ error: "note is required" }, { status: 400 });
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return NextResponse.json(
      { error: `note must be at most ${MAX_NOTE_LENGTH} characters` },
      { status: 400 }
    );
  }

  const admin = createServiceRoleClient();

  const { count: revisions } = await admin
    .from("job_events")
    .select("id", { count: "exact", head: true })
    .eq("job_id", id)
    .eq("type", "sent_back");
  if ((revisions ?? 0) >= MAX_REVISIONS_PER_JOB) {
    return NextResponse.json(
      { error: `This job has already been sent back ${MAX_REVISIONS_PER_JOB} times` },
      { status: 429 }
    );
  }

  const result = await reviseJob(supabase, admin, id, user.id, note);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Sama seperti POST /api/jobs: kalau ini job Research Ward, Deepdive
  // langsung mengerjakan ulang briefnya dengan catatan revisi si client
  // (Fase 1 item 10), sebelum request ini selesai.
  if (result.district === "research") {
    await runResearchJob(id).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
