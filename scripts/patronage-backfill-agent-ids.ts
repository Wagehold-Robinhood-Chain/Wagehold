/**
 * Mengisi agents.chain_agent_id (0018) = keccak256(bytes(agents.id)) -- agentId on-chain yang dipakai
 * Patronage / Splitter v2. Rumus yang SAMA dengan computeJobId() di lib/web3/strongbox.ts dan registerJob
 * di lib/web3/council.ts, tidak bisa dihitung di SQL.
 *
 * Jalankan SEKALI setelah migrasi 0018 (dan lagi kalau ada Wright baru):
 *   npx tsx --env-file=.env.local scripts/patronage-backfill-agent-ids.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/patronage-backfill-agent-ids.ts
 *
 * Mencetak daftar `agentId  nama` untuk dipakai BUILDING_UUIDS / registerBuilding di rollout kontrak:
 * bangunan yang agentId-nya tidak terdaftar di Patronage tidak akan muncul di /api/patronage/pools.
 */
import { createClient } from "@supabase/supabase-js";
import { keccak256, toBytes } from "viem";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data, error } = await db.from("agents").select("id, name, code, chain_agent_id").order("name");
  if (error) throw error;

  let changed = 0, failed = 0;
  for (const a of data ?? []) {
    const want = keccak256(toBytes(a.id));
    const note = a.chain_agent_id == null ? "set" : a.chain_agent_id === want ? "ok" : "DIFFERENT (overwrite)";
    console.log(`${want}  ${a.code ?? ""}  ${a.name}  [${note}]`);
    if (a.chain_agent_id === want) continue;
    if (dry) { changed++; continue; }
    const { error: e } = await db.from("agents").update({ chain_agent_id: want }).eq("id", a.id);
    if (e) { console.error(`  ! ${a.id}: ${e.message}`); failed++; } else changed++;
  }
  console.log(`\n${dry ? "Would update" : "Updated"} ${changed} of ${data?.length ?? 0} agents${failed ? `, ${failed} failed` : ""}.`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
