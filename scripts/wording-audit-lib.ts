/**
 * Audit kata terlarang (Dev Brief §10): pindai seluruh teks proyek dengan `findForbiddenWording`.
 * Dipakai scripts/audit-wording.ts (CLI) dan scripts/test-patronage-4d.ts.
 * Dikecualikan: file yang MEMUAT daftar atau contoh kata itu sendiri (lib/wording.ts, skrip uji, dan file ini).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { findForbiddenWording } from "@/lib/wording";

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "out", "build"]);
const TEXT_EXT = /\.(ts|tsx|js|mjs|json|md|sql|sol|css|sh|example)$/i;
// 0003 dan 0008 adalah prompt agen yang MELARANG kata "guaranteed" ("never say guaranteed"): memuat kata itu justru
// sebagai larangan, bukan sebagai teks ke user. Migrasi lama tidak diubah.
const EXEMPT = [/^supabase\/migrations\/000[38]_.*\.sql$/, /^lib\/wording\.ts$/, /^scripts\/test-.*\.ts$/, /^scripts\/audit-wording\.ts$/, /^scripts\/wording-audit-lib\.ts$/, /^package-lock\.json$/, /\.tsbuildinfo$/];

export interface WordingHit {
  file: string;
  line: number;
  words: string[];
  text: string;
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (TEXT_EXT.test(name) || name === ".env.local.example") yield p;
  }
}

export function scanWording(root: string): { files: number; hits: WordingHit[] } {
  let files = 0;
  const hits: WordingHit[] = [];
  for (const abs of walk(root)) {
    const rel = relative(root, abs).split("\\").join("/");
    if (EXEMPT.some((re) => re.test(rel))) continue;
    files++;
    readFileSync(abs, "utf8")
      .split("\n")
      .forEach((text, i) => {
        const words = findForbiddenWording(text);
        if (words.length) hits.push({ file: rel, line: i + 1, words, text: text.trim().slice(0, 160) });
      });
  }
  return { files, hits };
}
