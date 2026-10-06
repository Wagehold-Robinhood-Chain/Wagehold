/**
 * Rekonsiliasi indexer vs kontrak (Dev Brief §9.7: "a script compares on-chain balances against the indexer").
 * Aman dijalankan kapan saja, hanya membaca. Exit code 1 kalau ada selisih -> bisa dipasang di monitor 72 jam.
 *   npx tsx --env-file=.env.local scripts/patronage-reconcile.ts
 *
 * Yang dicek:
 *  1. Solvency: balanceOf(Patronage) >= accountedBalance() (ledger internal kontrak).
 *  2. Per bangunan: total_staked / rewards_total / redirected_total di building_pools == getPool() on-chain,
 *     dibaca PADA blok yang sama dengan cursor indexer (patronage_applied), jadi tertinggalnya indexer
 *     bukan selisih. Butuh RPC yang menyimpan state historis; kalau tidak, skrip memberi tahu dan membaca "latest".
 *  3. Σ total_staked indexer == totalStakedAll() on-chain (kalau kontrak punya view itu).
 */
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, http, parseAbi } from "viem";
import { activeChain } from "../lib/web3/chains";
import { ADDRESSES, PATRONAGE } from "../lib/web3/addresses";

const abi = parseAbi([
  "function accountedBalance() view returns (uint256)",
  "function getPool(bytes32 agentId) view returns ((uint256 totalStaked, uint256 accRewardPerShare, uint256 remainder, uint256 rewardsTotal, uint256 redirectedTotal))",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const big = (v: string) => BigInt(v.split(".")[0] || "0");

async function main() {
  if (!PATRONAGE.patronage) throw new Error("WEIGHHOUSE_PATRONAGE_ADDRESS belum diisi");
  const client = createPublicClient({ chain: activeChain, transport: http(process.env.WEIGHHOUSE_RPC_URL || undefined) });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const address = PATRONAGE.patronage;
  let bad = 0;
  const fail = (msg: string) => { bad++; console.log(`  MISMATCH  ${msg}`); };

  const st = await db.from("indexer_state").select("last_block").eq("key", `patronage_applied:${address}`).maybeSingle();
  if (!st.data) throw new Error("Indexer Patronage belum jalan (belum ada cursor patronage_applied).");
  const at = BigInt(st.data.last_block);
  console.log(`Chain ${activeChain.name} (${activeChain.id}); Patronage ${address}; indexer applied to block ${at}`);

  // 1. solvency (di blok terbaru: invarian ini harus berlaku kapan pun)
  const [balance, accounted] = await Promise.all([
    client.readContract({ address: ADDRESSES.wageToken, abi: erc20, functionName: "balanceOf", args: [address] }),
    client.readContract({ address, abi, functionName: "accountedBalance" }),
  ]);
  console.log(`\nSolvency: balance ${balance} vs accountedBalance ${accounted}`);
  if (balance < accounted) fail("balanceOf(Patronage) < accountedBalance()");

  // 2. per bangunan, pada blok cursor
  const { data: pools, error } = await db.rpc("patronage_pools", { p_since: null });
  if (error) throw error;
  let sumStaked = 0n;
  let historic = true;
  for (const p of pools ?? []) {
    const read = (blockNumber?: bigint) =>
      client.readContract({ address, abi, functionName: "getPool", args: [p.chain_agent_id as `0x${string}`], blockNumber });
    let onchain;
    try { onchain = await read(at); } catch {
      if (historic) console.log("  (RPC tidak punya state historis -- membaca 'latest'; selisih kecil bisa hanya lag indexer)");
      historic = false; onchain = await read();
    }
    const db_ = { staked: big(p.total_staked), rewards: big(p.rewards_total), redirected: big(p.redirected_total) };
    sumStaked += db_.staked;
    const same = db_.staked === onchain.totalStaked && db_.rewards === onchain.rewardsTotal && db_.redirected === onchain.redirectedTotal;
    console.log(`${same ? "ok       " : "MISMATCH "} ${p.name ?? p.chain_agent_id}`);
    if (!same) {
      fail(`${p.name}: staked db=${db_.staked} chain=${onchain.totalStaked}; rewards db=${db_.rewards} chain=${onchain.rewardsTotal}; redirected db=${db_.redirected} chain=${onchain.redirectedTotal}`);
    }
  }

  // 3. total
  try {
    const total = await client.readContract({ address, abi: parseAbi(["function totalStakedAll() view returns (uint256)"]), functionName: "totalStakedAll", blockNumber: historic ? at : undefined });
    console.log(`\nΣ staked: indexer ${sumStaked} vs chain ${total}`);
    if (sumStaked !== total) fail("Σ total_staked != totalStakedAll()");
  } catch { console.log("\n(kontrak tidak punya totalStakedAll(); cek Σ dilewati)"); }

  console.log(bad ? `\n${bad} selisih.` : "\nSemua cocok.");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
