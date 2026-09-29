import { NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { createJob, listJobs } from '@/lib/supabase/queries';
import { runWardJob } from '@/lib/agents/wright-runtime';
import { verifyOnChainLock } from '@/lib/web3/verify-lock';
import { isOnChainEscrowConfigured } from '@/lib/web3/strongbox';
import { WARD_LABEL } from '@/types/domain';
import type { JobStatus } from '@/types/enums';

// Wright yang dipilih Warden mengerjakan lewat Gemini di dalam request ini --
// beri waktu cukup di Vercel.
export const maxDuration = 60;

// Batas input & penyalahgunaan (tiap job baru = satu panggilan Gemini).
const MAX_TITLE_LENGTH = 120;
const MAX_BRIEF_LENGTH = 4000;
const MAX_SIMULATED_BUDGET_USDC = 1_000_000;
const MAX_JOBS_PER_HOUR = 10;
const VALID_DISTRICTS = Object.keys(WARD_LABEL);

// Format yang dikirim lib/web3/lock-wage.ts dari browser (Fase 2 item 6).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH_RE = /^0x[0-9a-f]{64}$/i;

const VALID_STATUSES: JobStatus[] = [
  'open',
  'working',
  'review',
  'revision',
  'paid',
  'disputed',
  'cancelled',
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status'); // e.g. "review,working"

  let statuses: JobStatus[] | undefined;
  if (statusParam) {
    const parsed = statusParam
      .split(',')
      .filter((s): s is JobStatus => VALID_STATUSES.includes(s as JobStatus));
    if (parsed.length === 0) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      );
    }
    statuses = parsed;
  }

  const supabase = await createClient();
  const { data, error } = await listJobs(supabase, statuses);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: data });
}

export async function POST(request: Request) {
  const supabase = await createClient();

  // Article III Charter: hanya client yang sudah login yang boleh
  // mengunci wage. Dicek di sini, bukan cuma mengandalkan proxy.ts.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Sign in to post a job' },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const brief = typeof body?.brief === 'string' ? body.brief.trim() : '';
  if (
    !body ||
    !title ||
    !brief ||
    typeof body.district !== 'string' ||
    typeof body.budgetUsdc !== 'number' ||
    !Number.isFinite(body.budgetUsdc) ||
    body.budgetUsdc <= 0
  ) {
    return NextResponse.json(
      {
        error:
          'title, brief, district (string) and budgetUsdc (number > 0) are required',
      },
      { status: 400 },
    );
  }
  if (title.length > MAX_TITLE_LENGTH || brief.length > MAX_BRIEF_LENGTH) {
    return NextResponse.json(
      {
        error: `title must be at most ${MAX_TITLE_LENGTH} characters and brief at most ${MAX_BRIEF_LENGTH}`,
      },
      { status: 400 },
    );
  }
  if (!VALID_DISTRICTS.includes(body.district)) {
    return NextResponse.json(
      { error: `district must be one of: ${VALID_DISTRICTS.join(', ')}` },
      { status: 400 },
    );
  }

  // Semua penulisan lewat service role (0005_harden_rls.sql). Auth sudah dicek di atas.
  const admin = createServiceRoleClient();

  // Rate limit sederhana berbasis database (cocok untuk serverless, tanpa Redis):
  // maksimal MAX_JOBS_PER_HOUR job baru per user per jam.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentJobs } = await admin
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', user.id)
    .gte('created_at', since);
  if ((recentJobs ?? 0) >= MAX_JOBS_PER_HOUR) {
    return NextResponse.json(
      {
        error: `Too many jobs -- limit is ${MAX_JOBS_PER_HOUR} per hour. Try again later.`,
      },
      { status: 429 },
    );
  }

  // Kalau escrow on-chain sudah dikonfigurasi, alur simulasi ditutup: job tanpa
  // wage yang benar-benar terkunci tidak boleh masuk (kalau tidak, siapa pun bisa
  // membuat job "berbayar" palsu yang lalu di-seal untuk mengkredit revenue agent).
  if (isOnChainEscrowConfigured && typeof body.escrowTx !== 'string') {
    return NextResponse.json(
      { error: 'The wage must be locked on-chain before posting a job' },
      { status: 400 },
    );
  }

  let id: string | undefined;
  let escrowTx: string | undefined;
  let budgetUsdc: number = body.budgetUsdc;

  // Fase 2 item 6: kalau client mengirim `id` + `escrowTx`, itu berarti
  // lib/web3/lock-wage.ts (dipanggil dari post-job-client.tsx) sudah
  // mengunci wage di WageholdStrongbox SEBELUM request ini dikirim -- baris
  // job di sini cuma mencatat apa yang sudah sungguhan terjadi di chain,
  // bukan yang memicunya. Diverifikasi lewat RPC dulu (bukan sekadar
  // dipercaya dari body) supaya client tidak bisa klaim wage lebih besar
  // dari yang benar-benar terkunci -- lihat verifyOnChainLock.
  if (typeof body.id === 'string' || typeof body.escrowTx === 'string') {
    if (typeof body.id !== 'string' || typeof body.escrowTx !== 'string') {
      return NextResponse.json(
        { error: 'id and escrowTx must both be present together' },
        { status: 400 },
      );
    }
    if (!UUID_RE.test(body.id) || !TX_HASH_RE.test(body.escrowTx)) {
      return NextResponse.json(
        { error: 'invalid id or escrowTx format' },
        { status: 400 },
      );
    }

    try {
      const verified = await verifyOnChainLock(body.id);
      id = body.id;
      escrowTx = body.escrowTx;
      // Otoritatif dari chain, bukan dari body -- lihat catatan di
      // verifyOnChainLock kenapa ini menggantikan body.budgetUsdc.
      budgetUsdc = verified.budgetUsdc;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      return NextResponse.json(
        { error: `Could not verify the on-chain lock: ${message}` },
        { status: 400 },
      );
    }
  }

  if (!escrowTx && budgetUsdc > MAX_SIMULATED_BUDGET_USDC) {
    return NextResponse.json(
      { error: `budgetUsdc must be at most ${MAX_SIMULATED_BUDGET_USDC}` },
      { status: 400 },
    );
  }

  const { data, error } = await createJob(admin, user.id, {
    id,
    title,
    brief,
    district: body.district,
    budgetUsdc,
    escrowTx,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fase 3 item 4: kelima Ward sekarang hidup (dulu cuma Research Ward,
  // Fase 1 item 10). runWardJob memilih Wright lewat selectWright (item 5)
  // dan langsung mengerjakan brief lewat Gemini sebelum request ini selesai,
  // supaya client langsung melihat statusnya bergerak ke 'review' di Job
  // Board. Kegagalan di sini TIDAK membatalkan job -- wage tetap aman di
  // Strongbox dan kegagalannya dicatat sendiri ke Ledger Wall oleh runWardJob.
  await runWardJob(data.id).catch(() => {});

  return NextResponse.json({ job: data }, { status: 201 });
}
