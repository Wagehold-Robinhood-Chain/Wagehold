import type { Log } from "viem";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { weighhouseClient as publicClient } from "./rpc";
import { ADDRESSES, OPEN_ITEMS, PONS } from "@/lib/web3/addresses";
import { CURVE_EVENTS, POOL_GRADUATED_EVENT, POOL_SWAP_EVENT, SPLITTER_EVENTS, STRONGBOX_EVENTS } from "./events";
import { wagePoolKey } from "./pons";

const WORK_STATE_KEY = "chain_events"; // Strongbox + Splitter (kunci lama dipertahankan: dipakai halaman)
const REORG_BUFFER = 2n;
const CHUNK = 5000n;
const MAX_CHUNKS_PER_STREAM = 10; // batasi durasi satu invokasi cron (maxDuration 60 dtk)
const BLOCK_FETCH_BATCH = 25;

type Row = {
  tx_hash: string; log_index: number; block_number: number; block_time: string;
  contract: string; event: string; chain_job_id: string | null;
  amount: string | null; args: Record<string, string>;
};

const s = (v: unknown) => (typeof v === "bigint" ? v.toString() : String(v));
const abs = (v: bigint) => (v < 0n ? -v : v);

/** Ubah satu log ter-decode jadi baris chain_events. Definisi `amount` per event (lihat migrasi 0014/0015). */
function toRow(log: Log & { eventName?: string; args?: Record<string, unknown> }, time: Date): Row | null {
  if (!log.eventName || !log.args || !log.transactionHash || log.logIndex == null || log.blockNumber == null) return null;
  const a = log.args as Record<string, bigint | string>;
  const args: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) args[k] = s(v);

  let amount: bigint | null = null;
  switch (log.eventName) {
    case "JobFunded": case "SealSet": case "JobRefunded": case "JobRegistered": case "Burned":
      amount = a.amount as bigint; break;
    case "DisputeResolved": amount = (a.payeeAmount as bigint) + (a.refundAmount as bigint); break;
    case "JobSplit":
      amount = (a.patronAmount as bigint) + (a.lampOilAmount as bigint) + (a.titheAmount as bigint) + (a.burnAmount as bigint); break;
    // Trade pasar: SISI WAGE saja (brief §4.1 -- "absolute $WAGE amount over all buy and sell trades").
    case "CurveBuy": amount = a.tokensOut as bigint; break;  // pembeli menerima WAGE
    case "CurveSell": amount = a.tokensIn as bigint; break;  // penjual menyetor WAGE
    case "Swap": {
      // Urutan currency v4 = urutan alamat; wageIsToken0 diturunkan dari alamat (pons.ts).
      amount = abs((wagePoolKey().wageIsToken0 ? a.amount0 : a.amount1) as bigint); break;
    }
    case "PoolGraduated": amount = a.tokenAmount as bigint; break; // momen graduation (garis vertikal grafik harga)
    case "SealBroken": amount = null; break;
    default: return null;
  }

  return {
    tx_hash: log.transactionHash,
    log_index: Number(log.logIndex),
    block_number: Number(log.blockNumber),
    block_time: time.toISOString(),
    contract: log.address.toLowerCase(),
    event: log.eventName,
    chain_job_id: typeof a.jobId === "string" ? a.jobId.toLowerCase() : null,
    amount: amount == null ? null : amount.toString(),
    args,
  };
}

/** Aliran 1: kerja (Strongbox + Splitter). Mulai dari WEIGHHOUSE_DEPLOY_BLOCK. */
function workLogs(from: bigint, to: bigint): Promise<Log[]>[] {
  return [
    publicClient.getLogs({ address: ADDRESSES.strongbox, events: STRONGBOX_EVENTS, fromBlock: from, toBlock: to }),
    publicClient.getLogs({ address: ADDRESSES.splitter, events: SPLITTER_EVENTS, fromBlock: from, toBlock: to }),
  ];
}

/** Aliran 2: pasar ($WAGE di curve + pool v4 + momen graduation). Penyebut Work Ratio. */
function marketLogs(from: bigint, to: bigint): Promise<Log[]>[] {
  const calls: Promise<Log[]>[] = [
    // Swap v4 untuk pool $WAGE (ID diturunkan dari token + hook Pons). Kosong sebelum graduation -- aman.
    publicClient.getLogs({
      address: PONS.poolManager, event: POOL_SWAP_EVENT, args: { id: wagePoolKey().poolId }, fromBlock: from, toBlock: to,
    }) as unknown as Promise<Log[]>,
    publicClient.getLogs({
      address: PONS.launchFactory, event: POOL_GRADUATED_EVENT, args: { token: ADDRESSES.wageToken }, fromBlock: from, toBlock: to,
    }) as unknown as Promise<Log[]>,
  ];
  if (OPEN_ITEMS.wageCurve) {
    calls.push(publicClient.getLogs({ address: OPEN_ITEMS.wageCurve, events: CURVE_EVENTS, fromBlock: from, toBlock: to }));
  }
  return calls;
}

async function blockTimes(blocks: bigint[]): Promise<Map<bigint, Date>> {
  const times = new Map<bigint, Date>();
  for (let i = 0; i < blocks.length; i += BLOCK_FETCH_BATCH) {
    await Promise.all(
      blocks.slice(i, i + BLOCK_FETCH_BATCH).map(async (n) => {
        const b = await publicClient.getBlock({ blockNumber: n });
        times.set(n, new Date(Number(b.timestamp) * 1000));
      }),
    );
  }
  return times;
}

type Db = ReturnType<typeof createServiceRoleClient>;

/** Jalankan satu aliran dengan cursor sendiri: idempoten (upsert on conflict (tx_hash, log_index)). */
async function runStream(
  db: Db, key: string, startBlock: bigint, latest: bigint,
  fetch: (from: bigint, to: bigint) => Promise<Log[]>[],
) {
  const stateRes = await db.from("indexer_state").select("last_block").eq("key", key).maybeSingle();
  const last = stateRes.data ? BigInt(stateRes.data.last_block) : startBlock - 1n;

  const target = latest - REORG_BUFFER;
  let from = last + 1n;
  let inserted = 0;
  let chunks = 0;

  while (from <= target && chunks < MAX_CHUNKS_PER_STREAM) {
    const to = from + CHUNK - 1n > target ? target : from + CHUNK - 1n;
    const logs = (await Promise.all(fetch(from, to))).flat();

    const times = await blockTimes([...new Set(logs.map((l) => l.blockNumber as bigint))]);
    const rows = logs.map((l) => toRow(l, times.get(l.blockNumber as bigint)!)).filter((r): r is Row => !!r);
    if (rows.length) {
      const { error } = await db.from("chain_events").upsert(rows as never, { onConflict: "tx_hash,log_index", ignoreDuplicates: true });
      if (error) return { ok: false as const, key, error: error.message };
      inserted += rows.length;
    }

    // maju hanya setelah chunk sukses ditulis
    await db.from("indexer_state").upsert({ key, last_block: Number(to) });
    from = to + 1n;
    chunks++;
  }
  return { ok: true as const, key, indexedTo: Number(from - 1n), inserted, caughtUp: from > target };
}

/** Satu putaran indexer untuk kedua aliran. Cursor aliran pasar memuat konfigurasinya (curve + pool),
 *  jadi mengisi WEIGHHOUSE_WAGE_CURVE belakangan memulai ulang aliran itu dari blok awal -- tanpa event terlewat. */
export async function runIndexer() {
  if (OPEN_ITEMS.deployBlock === undefined) {
    return { ok: false as const, error: "WEIGHHOUSE_DEPLOY_BLOCK belum diisi (jalankan scripts/weighhouse-discover.ts)." };
  }
  const db = createServiceRoleClient();
  const latest = await publicClient.getBlockNumber();

  const marketKey = `market:${OPEN_ITEMS.wageCurve ?? "nocurve"}:${wagePoolKey().poolId}`;
  const marketStart = OPEN_ITEMS.marketStartBlock ?? OPEN_ITEMS.deployBlock;

  const work = await runStream(db, WORK_STATE_KEY, OPEN_ITEMS.deployBlock, latest, workLogs);
  const market = await runStream(db, marketKey, marketStart, latest, marketLogs);

  return {
    ok: work.ok && market.ok,
    latest: Number(latest),
    work,
    market: { ...market, curveConfigured: !!OPEN_ITEMS.wageCurve },
  };
}
