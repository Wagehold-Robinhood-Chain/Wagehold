import { createServiceRoleClient } from "@/lib/supabase/server";
import { PATRONAGE } from "@/lib/web3/addresses";
import type { PatronagePoolRaw, PatronagePositionRaw, PatronageRewardRaw } from "@/types/database";

/**
 * Data Patronage on-chain untuk /api/patronage/* (Dev Brief §7.3).
 *
 * Sumber: tabel turunan `building_pools` / `patron_positions` (0018), diisi indexer dari event
 * kontrak. Data ini TERTINGGAL beberapa menit dari chain (cron 1 menit + REORG_BUFFER), jadi:
 *   - daftar, riwayat, dan total  -> dari sini;
 *   - angka live (pending rewards, sisa cooldown, saldo) -> view call kontrak lewat viem di UI.
 * Semua jumlah adalah string base unit ($WAGE 18 desimal): numeric(78,0) tidak muat di number JS.
 */

export const POOL_WINDOW_DAYS = 7;
export type PoolSort = "staked" | "wages7d";

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** "123" / "123.0" -> 123n. Hasil `numeric::text` dari Postgres; skala selalu 0, jadi tidak ada pecahan nyata. */
const toBig = (v: string | null | undefined): bigint => BigInt((v ?? "0").split(".")[0] || "0");
const cmpDesc = (a: string, b: string) => {
  const x = toBig(a), y = toBig(b);
  return x === y ? 0 : x > y ? -1 : 1;
};

export interface PoolView {
  /** agents.id (uuid) */
  agentId: string;
  /** bytes32 on-chain = keccak256(bytes(agentId)) */
  chainAgentId: string;
  name: string;
  code: string;
  ward: string;
  registered: boolean;
  totalStaked: string;
  patronCount: number;
  /** Σ reward yang pernah dibagi ke patron bangunan ini (all time) */
  rewardsTotal: string;
  /** Σ reward yang dialihkan ke treasury karena tidak ada staker (all time) */
  redirectedTotal: string;
  /** Upah tersegel 7 hari terakhir */
  sealed7d: string;
  jobsSealed7d: number;
  /** Bagian patron (60%) dari upah yang dibagi 7 hari terakhir -- Splitter v2 saja (v1 tidak punya agentId) */
  patronCut7d: string;
  /** Bagian dari patronCut7d yang benar-benar dibagi ke staker (sisanya dialihkan ke treasury) */
  paidToPatrons7d: string;
}

function mapPool(r: PatronagePoolRaw): PoolView {
  return {
    agentId: r.agent_id,
    chainAgentId: r.chain_agent_id,
    name: r.name,
    code: r.code,
    ward: r.district,
    registered: r.registered,
    totalStaked: r.total_staked,
    patronCount: r.patron_count,
    rewardsTotal: r.rewards_total,
    redirectedTotal: r.redirected_total,
    sealed7d: r.sealed_window,
    jobsSealed7d: Number(r.jobs_window),
    patronCut7d: r.patron_cut_window,
    paidToPatrons7d: r.notified_window,
  };
}

/** Blok terakhir yang sudah diterapkan ke tabel turunan (untuk label "data sampai blok N" di UI). null = belum jalan. */
export async function getIndexedBlock(): Promise<number | null> {
  if (!PATRONAGE.patronage) return null;
  const { data } = await createServiceRoleClient()
    .from("indexer_state")
    .select("last_block")
    .eq("key", `patronage_applied:${PATRONAGE.patronage}`)
    .maybeSingle();
  return data ? Number(data.last_block) : null;
}

export async function getPools(sort: PoolSort): Promise<PoolView[]> {
  const since = new Date(Date.now() - POOL_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await createServiceRoleClient().rpc("patronage_pools", { p_since: since });
  if (error) throw new Error(`patronage_pools: ${error.message}`);

  const pools = (data ?? []).map(mapPool);
  const key = sort === "wages7d" ? (p: PoolView) => p.sealed7d : (p: PoolView) => p.totalStaked;
  // urut menurun; seri -> nama, supaya urutan stabil antar-refresh
  pools.sort((a, b) => cmpDesc(key(a), key(b)) || a.name.localeCompare(b.name));
  return pools;
}

export interface RewardView {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTime: string;
  /** 'shared' = dibagi ke patron; 'redirected' = tanpa staker, dialihkan ke treasury */
  kind: "shared" | "redirected";
  amount: string;
  /** jobId on-chain (bytes32) dan, kalau dikenal app, jobs.id untuk tautan ke halaman job */
  chainJobId: string | null;
  jobId: string | null;
}

const mapReward = (r: PatronageRewardRaw): RewardView => ({
  txHash: r.tx_hash,
  logIndex: r.log_index,
  blockNumber: Number(r.block_number),
  blockTime: r.block_time,
  kind: r.kind,
  amount: r.amount,
  chainJobId: r.chain_job_id,
  jobId: r.job_id,
});

/** `idOrChainId` = agents.id (uuid) ATAU bytes32 on-chain. null = bukan bangunan Patronage yang dikenal. */
export async function getPool(idOrChainId: string, rewardLimit = 20): Promise<{ pool: PoolView; rewards: RewardView[] } | null> {
  const isChain = BYTES32.test(idOrChainId);
  if (!isChain && !UUID.test(idOrChainId)) return null;

  // Hanya ~20 bangunan: ambil semua dan pilih satu, daripada fungsi SQL kedua dengan logika yang sama.
  const pools = await getPools("staked");
  const pool = pools.find((p) => (isChain ? p.chainAgentId === idOrChainId.toLowerCase() : p.agentId === idOrChainId.toLowerCase()));
  if (!pool) return null;

  const { data, error } = await createServiceRoleClient().rpc("patronage_pool_rewards", {
    p_chain_agent_id: pool.chainAgentId,
    p_limit: rewardLimit,
  });
  if (error) throw new Error(`patronage_pool_rewards: ${error.message}`);
  return { pool, rewards: (data ?? []).map(mapReward) };
}

export interface PositionView {
  chainAgentId: string;
  /** null = bangunan belum dipetakan (agents.chain_agent_id kosong -> jalankan scripts/patronage-backfill-agent-ids.ts) */
  agentId: string | null;
  name: string | null;
  code: string | null;
  ward: string | null;
  staked: string;
  cooling: string;
  /** ISO. null = tidak ada cooldown berjalan. Sisa waktu dihitung UI dari jam sendiri. */
  unlockAt: string | null;
  claimedTotal: string;
  updatedBlock: number;
}

const mapPosition = (r: PatronagePositionRaw): PositionView => ({
  chainAgentId: r.chain_agent_id,
  agentId: r.agent_id,
  name: r.name,
  code: r.code,
  ward: r.district,
  staked: r.staked,
  cooling: r.cooling,
  unlockAt: r.unlock_at,
  claimedTotal: r.claimed_total,
  updatedBlock: Number(r.updated_block),
});

/** `wallet` harus sudah divalidasi (isAddress) oleh pemanggil. */
export async function getPositions(wallet: string) {
  const { data, error } = await createServiceRoleClient().rpc("patronage_positions_of", { p_wallet: wallet.toLowerCase() });
  if (error) throw new Error(`patronage_positions_of: ${error.message}`);

  const positions = (data ?? []).map(mapPosition);
  let staked = 0n, cooling = 0n, claimed = 0n;
  for (const p of positions) {
    staked += toBig(p.staked);
    cooling += toBig(p.cooling);
    claimed += toBig(p.claimedTotal);
  }
  return {
    positions,
    totals: { staked: staked.toString(), cooling: cooling.toString(), claimedTotal: claimed.toString() },
  };
}
