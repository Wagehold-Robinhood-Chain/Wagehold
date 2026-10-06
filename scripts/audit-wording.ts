/**
 * Audit kata terlarang (Dev Brief §10), seluruh proyek:
 *   npx tsx scripts/audit-wording.ts        # exit 1 bila ada temuan
 */
import { scanWording } from "./wording-audit-lib";

const { files, hits } = scanWording(process.cwd());
for (const h of hits) console.log(`${h.file}:${h.line}  [${h.words.join(", ")}]  ${h.text}`);
console.log(`\n${files} file dipindai, ${hits.length} temuan`);
process.exit(hits.length ? 1 : 0);
