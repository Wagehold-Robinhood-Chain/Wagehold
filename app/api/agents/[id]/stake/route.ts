import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getSimClientId } from '@/lib/identity/server';
import { isWalletMode } from '@/lib/identity/mode';
import { MAX_STAKE_PER_ACTION, MAX_STAKE_PER_BUILDING } from '@/lib/patronage';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Patronage, MODE SIMULASI: stake / unstake $WAGE pada sebuah bangunan.
 *
 * Tidak ada token yang bergerak dan tidak ada saldo yang dicek -- hanya catatan di
 * tabel `stakes`. Identitas patron = cookie `wh_sim` browser (sama seperti pemilik
 * job). Di mode wallet staking on-chain belum ada, jadi ditolak apa adanya daripada
 * berpura-pura memindahkan token.
 *
 *   POST   { amount }  -> tambah stake
 *   DELETE { amount }  -> tarik sebagian / seluruh stake
 */

async function prepare(
  request: Request,
  paramsPromise: Promise<{ id: string }>,
) {
  const { id } = await paramsPromise;
  if (!UUID_RE.test(id)) {
    return { error: NextResponse.json({ error: 'Invalid building id' }, { status: 400 }) };
  }
  if (isWalletMode) {
    return {
      error: NextResponse.json(
        { error: "On-chain staking isn't live yet. Staking works in simulation mode only." },
        { status: 501 },
      ),
    };
  }

  const body = await request.json().catch(() => null);
  const amount = body?.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { error: NextResponse.json({ error: 'amount must be a number greater than 0' }, { status: 400 }) };
  }
  if (amount > MAX_STAKE_PER_ACTION) {
    return {
      error: NextResponse.json(
        { error: `amount must be at most ${MAX_STAKE_PER_ACTION.toLocaleString('en-US')} WAGE per action` },
        { status: 400 },
      ),
    };
  }
  // Maksimal 6 desimal (kolom numeric dibulatkan di fungsi SQL pada 6 desimal juga).
  const rounded = Math.round(amount * 1e6) / 1e6;
  if (rounded <= 0) {
    return { error: NextResponse.json({ error: 'amount is too small' }, { status: 400 }) };
  }

  const stakerId = await getSimClientId();
  if (!stakerId) {
    return {
      error: NextResponse.json(
        { error: 'This browser has no identity yet -- reload the page and try again' },
        { status: 400 },
      ),
    };
  }

  const admin = createServiceRoleClient();
  const { data: agent } = await admin
    .from('agents')
    .select('id, name, is_lead')
    .eq('id', id)
    .single();
  if (!agent) {
    return { error: NextResponse.json({ error: 'Building not found' }, { status: 404 }) };
  }

  return { admin, agent, stakerId, amount: rounded };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await prepare(request, params);
  if ('error' in ctx) return ctx.error;
  const { admin, agent, stakerId, amount } = ctx;

  // A Warden routes work but never takes jobs, so they never earn a patron cut.
  if (agent.is_lead) {
    return NextResponse.json(
      {
        error:
          "A Warden routes work but doesn't take jobs, so it has no patron cut. Stake on a Wright in this Ward instead.",
      },
      { status: 400 },
    );
  }

  const { data: current } = await admin
    .from('stakes')
    .select('amount')
    .eq('staker_id', stakerId)
    .eq('agent_id', agent.id)
    .maybeSingle();
  if (Number(current?.amount ?? 0) + amount > MAX_STAKE_PER_BUILDING) {
    return NextResponse.json(
      {
        error: `A patron can stake at most ${MAX_STAKE_PER_BUILDING.toLocaleString('en-US')} WAGE on one building (simulation limit)`,
      },
      { status: 400 },
    );
  }

  const { data, error } = await admin.rpc('stake_wage', {
    p_staker: stakerId,
    p_agent: agent.id,
    p_amount: amount,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stake: Number(data) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await prepare(request, params);
  if ('error' in ctx) return ctx.error;
  const { admin, agent, stakerId, amount } = ctx;

  const { data, error } = await admin.rpc('unstake_wage', {
    p_staker: stakerId,
    p_agent: agent.id,
    p_amount: amount,
  });
  if (error) {
    const insufficient = error.message.includes('insufficient stake');
    return NextResponse.json(
      { error: insufficient ? "You can't unstake more than you have staked here" : error.message },
      { status: insufficient ? 409 : 500 },
    );
  }
  return NextResponse.json({ ok: true, stake: Number(data) });
}
