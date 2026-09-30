import { NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { approveJob } from '@/lib/supabase/queries';
import { isCouncilConfigured, splitAfterRelease } from '@/lib/web3/council';
import { verifyReleased } from '@/lib/web3/verify-release';
import { isOnChainEscrowConfigured } from '@/lib/web3/strongbox';
import { authorizeJobOwner } from '@/lib/identity/server';
import { sealDetail } from '@/lib/identity/wallet-auth';

const TX_HASH_RE = /^0x[0-9a-f]{64}$/i;

function parseRating(value: unknown): number | undefined | { error: string } {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 5
  ) {
    return { error: 'rating must be an integer from 1 to 5' };
  }
  return value;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  // Fase 2 item 7: job yang wage-nya terkunci on-chain (escrow_tx terisi)
  // tidak boleh ditandai 'paid' oleh database saja -- seal-nya harus sudah
  // terjadi di WageholdStrongbox (client memanggil approve() dari
  // walletnya sendiri, Charter I).
  const { data: jobRow } = await supabase
    .from('jobs')
    .select('client_id, escrow_tx, agent_id')
    .eq('id', id)
    .single();

  if (!jobRow) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Semua penulisan ke database lewat service role (0005_harden_rls.sql).
  const admin = createServiceRoleClient();

  let onChain: { sealTx?: string } | undefined;

  // Rating (1-5) opsional dari client -- dibaca sekali, dipakai di kedua jalur
  // (on-chain maupun simulated) sebelum approveJob() menuliskannya ke jobs.rating.
  const body = await request.json().catch(() => null);
  const rating = parseRating(body?.rating);
  if (rating && typeof rating === 'object') {
    return NextResponse.json({ error: rating.error }, { status: 400 });
  }

  // Job yang dikerjakan Wright wajib di-rate sebelum seal.
  if (jobRow.agent_id && typeof rating !== 'number') {
    return NextResponse.json(
      { error: 'Rate the Wright (1-5) before setting the seal' },
      { status: 400 },
    );
  }

  // Article I: hanya pemilik job. Tanpa login -- job simulasi dicocokkan ke cookie
  // browser, job wallet ke tanda tangan wallet (rating ikut ditandatangani).
  const owner = await authorizeJobOwner({
    clientId: jobRow.client_id,
    action: 'seal',
    jobId: id,
    detail: sealDetail(typeof rating === 'number' ? rating : undefined),
    auth: body?.auth,
    verb: 'set the seal',
  });
  if (!owner.ok) {
    return NextResponse.json({ error: owner.error }, { status: owner.status });
  }

  if (jobRow.escrow_tx) {
    if (!isOnChainEscrowConfigured) {
      return NextResponse.json(
        {
          error:
            "This job's wage is locked on-chain, but on-chain escrow isn't configured on the server",
        },
        { status: 503 },
      );
    }

    let sealTx: string | undefined;
    if (body && body.sealTx !== undefined) {
      if (typeof body.sealTx !== 'string' || !TX_HASH_RE.test(body.sealTx)) {
        return NextResponse.json(
          { error: 'invalid sealTx format' },
          { status: 400 },
        );
      }
      sealTx = body.sealTx;
    }

    try {
      await verifyReleased(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      return NextResponse.json(
        { error: `The seal isn't set on-chain yet: ${message}` },
        { status: 409 },
      );
    }

    onChain = { sealTx };
  }

  const result = await approveJob(
    supabase,
    admin,
    id,
    jobRow.client_id,
    onChain,
    typeof rating === 'number' ? rating : undefined,
  );

  if (result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  // Setelah seal on-chain: bagi wage lewat WageholdSplitter (kontrak yang sudah dideploy
  // sudah 60/20/10/10; bagian Furnace dibukukan di pendingBurn dan dibakar lewat burn()).
  // pullAndSplit permissionless, jadi kegagalan di sini TIDAK membatalkan
  // seal (wage sudah dilepas dan tercatat) -- cukup dicatat ke Ledger
  // supaya bisa dijalankan ulang oleh siapa saja.
  if (onChain && isCouncilConfigured) {
    try {
      const split = await splitAfterRelease(id);
      if (split.status === 'split') {
        await admin.from('job_events').insert({
          job_id: id,
          actor: 'system',
          type: 'split',
          note: 'The Splitter shared the wage on-chain.',
          tx: split.txHash,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      await admin.from('job_events').insert({
        job_id: id,
        actor: 'system',
        type: 'split_pending',
        note: `The wage is released, but the on-chain split didn't run (${message}). Anyone can call pullAndSplit later.`,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
