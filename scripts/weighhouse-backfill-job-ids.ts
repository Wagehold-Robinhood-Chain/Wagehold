/**
 * Mengisi jobs.chain_job_id untuk job on-chain yang dibuat SEBELUM migrasi 0014
 * (jobId on-chain = keccak256(bytes(uuid)), tidak bisa dihitung di SQL).
 *   npx tsx --env-file=.env.local scripts/weighhouse-backfill-job-ids.ts
 */
import { createClient } from "@supabase/supabase-js";
import { keccak256, toBytes } from "viem";

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await db.from("jobs").select("id").not("escrow_tx", "is", null).is("chain_job_id", null);
  if (error) throw error;
  let n = 0;
  for (const j of data ?? []) {
    const { error: e } = await db.from("jobs").update({ chain_job_id: keccak256(toBytes(j.id)) }).eq("id", j.id);
    if (e) console.error(j.id, e.message); else n++;
  }
  console.log(`Backfilled ${n}/${data?.length ?? 0} jobs.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
