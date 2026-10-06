/**
 * Pembanding event murni teks (tanpa viem / RPC / `forge build`): deklarasi `event X(...)` di
 * contracts/src/*.sol vs `parseAbiItem("event X(...)")` di lib/weighhouse/events.ts.
 * Dipakai scripts/weighhouse-verify-abi.ts dan scripts/test-patronage-4c.ts.
 *
 * Yang dibandingkan: nama event, urutan argumen, tipe, flag `indexed`, dan NAMA argumen (indexer memakai
 * `args.agentId`, `args.patronAmount`, dst., jadi nama berpengaruh, bukan hanya topic0).
 */

export interface EventArg {
  type: string;
  indexed: boolean;
  name: string;
}
export interface EventSig {
  name: string;
  args: EventArg[];
}

const stripComments = (src: string) => src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

function parseArgs(list: string): EventArg[] {
  return list
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const tokens = p.split(/\s+/);
      const indexed = tokens.includes("indexed");
      const rest = tokens.filter((t) => t !== "indexed");
      return { type: rest[0], indexed, name: rest[1] ?? "" };
    });
}

export const sigString = (e: EventSig) =>
  `${e.name}(${e.args.map((a) => `${a.type}${a.indexed ? " indexed" : ""} ${a.name}`.trim()).join(", ")})`;

/** Semua `event X(...);` di satu file Solidity, menurut nama. */
export function parseSolEvents(src: string): Map<string, EventSig> {
  const out = new Map<string, EventSig>();
  for (const m of stripComments(src).matchAll(/\bevent\s+(\w+)\s*\(([^)]*)\)\s*;/g)) {
    out.set(m[1], { name: m[1], args: parseArgs(m[2]) });
  }
  return out;
}

/** Event di dalam `export const <arrayName> = [ ... ]` pada teks events.ts (`parseAbiItem("event ...")`). */
export function parseEventsTs(src: string, arrayName: string): EventSig[] {
  const start = src.search(new RegExp(`export const ${arrayName}\\b[^=]*=\\s*\\[`));
  if (start < 0) throw new Error(`events.ts: array ${arrayName} tidak ditemukan`);
  const end = src.indexOf("] as const", start);
  if (end < 0) throw new Error(`events.ts: penutup ${arrayName} tidak ditemukan`);
  const region = src.slice(start, end);
  const out: EventSig[] = [];
  for (const m of region.matchAll(/parseAbiItem\(\s*"event\s+(\w+)\s*\(([^)]*)\)"\s*,?\s*\)/g)) {
    out.push({ name: m[1], args: parseArgs(m[2]) });
  }
  return out;
}

/** Selisih (kosong = cocok): tiap event `mine` harus ada di Solidity dengan tanda tangan yang sama persis. */
export function compareEvents(label: string, mine: readonly EventSig[], sol: Map<string, EventSig>): string[] {
  const problems: string[] = [];
  if (mine.length === 0) problems.push(`${label}: tidak ada event yang terbaca dari events.ts`);
  for (const ev of mine) {
    const want = sol.get(ev.name);
    if (!want) {
      problems.push(`${label}.${ev.name}: tidak ada di kontrak`);
    } else if (sigString(want) !== sigString(ev)) {
      problems.push(`${label}.${ev.name}: app "${sigString(ev)}" != kontrak "${sigString(want)}"`);
    }
  }
  return problems;
}
