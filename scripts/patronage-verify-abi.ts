/**
 * Membandingkan ABI di lib/web3/patronage-abi.ts dengan contracts/src/WageholdPatronage.sol:
 * nama, tipe input/output, dan stateMutability tiap fungsi, serta tanda tangan tiap custom error.
 *   npx tsx scripts/patronage-verify-abi.ts      (exit 1 kalau ada selisih)
 *
 * Murni teks, tanpa RPC. Yang diwarisi dari OpenZeppelin (`paused`, `EnforcedPause`) tidak ada di
 * file .sol ini, jadi dicek terhadap daftar kecil di bawah.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { patronageAbi } from "@/lib/web3/patronage-abi";

const INHERITED_FUNCTIONS: Record<string, string> = { paused: "paused()->bool" };
const INHERITED_ERRORS: Record<string, string> = { EnforcedPause: "EnforcedPause()" };

const src = readFileSync(join(process.cwd(), "contracts/src/WageholdPatronage.sol"), "utf8")
  .replace(/\/\/.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** "IERC20 token" -> "address"; "bytes32[] calldata ids" -> "bytes32[]"; "Pool memory" -> struct (tidak didukung). */
function solType(raw: string): string {
  const t = raw
    .replace(/\b(calldata|memory|storage|payable)\b/g, " ")
    .trim()
    .split(/\s+/)[0];
  if (/^I[A-Z]\w+$/.test(t) || /^[A-Z]\w+$/.test(t)) return t === "Pool" || t === "Position" ? `struct:${t}` : "address";
  return t;
}
const types = (list: string) =>
  list
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map(solType);

const fromSol = new Map<string, string>();

// function name(args) external|public [view|pure] [mods] [returns (...)]
for (const m of src.matchAll(/function\s+(\w+)\s*\(([^)]*)\)([^{;]*)[{;]/g)) {
  const [, name, args, tail] = m;
  if (!/\b(external|public)\b/.test(tail)) continue;
  const ret = /returns\s*\(([^)]*)\)/.exec(tail)?.[1] ?? "";
  const mut = /\bview\b/.test(tail) ? "view" : /\bpure\b/.test(tail) ? "pure" : "nonpayable";
  fromSol.set(name, `${name}(${types(args).join(",")})->${types(ret).join(",")}|${mut}`);
}
// public state variables -> getter
for (const m of src.matchAll(/^\s*(mapping\([^;]*?\)|[\w.]+)\s+public\s+(?:immutable\s+|constant\s+)?(\w+)\s*(?:=[^;]*)?;/gm)) {
  const [, type, name] = m;
  const map = /^mapping\((\w+)\s*=>\s*(.+)\)$/.exec(type.replace(/\s+/g, " "));
  const key = map ? solType(map[1]) : "";
  const out = map ? solType(map[2]) : solType(type);
  fromSol.set(name, `${name}(${key})->${out}|view`);
}
const errorsSol = new Map<string, string>();
for (const m of src.matchAll(/error\s+(\w+)\s*\(([^)]*)\)\s*;/g)) {
  errorsSol.set(m[1], `${m[1]}(${types(m[2]).join(",")})`);
}

const problems: string[] = [];
let checked = 0;

for (const item of patronageAbi) {
  if (item.type === "function") {
    const mine = `${item.name}(${item.inputs.map((i) => i.type).join(",")})->${item.outputs.map((o) => o.type).join(",")}|${item.stateMutability}`;
    const inherited = INHERITED_FUNCTIONS[item.name];
    if (inherited) {
      const shape = `${item.name}(${item.inputs.map((i) => i.type).join(",")})->${item.outputs.map((o) => o.type).join(",")}`;
      if (shape !== inherited) problems.push(`warisan OZ ${item.name}: ${shape} != ${inherited}`);
      checked++;
      continue;
    }
    const theirs = fromSol.get(item.name);
    if (!theirs) problems.push(`fungsi ${item.name} tidak ada di kontrak`);
    else if (theirs !== mine) problems.push(`fungsi ${item.name}\n    app     : ${mine}\n    kontrak : ${theirs}`);
    checked++;
  } else if (item.type === "error") {
    const mine = `${item.name}(${item.inputs.map((i) => i.type).join(",")})`;
    const theirs = INHERITED_ERRORS[item.name] ?? errorsSol.get(item.name);
    if (!theirs) problems.push(`error ${item.name} tidak ada di kontrak`);
    else if (theirs !== mine) problems.push(`error ${item.name}\n    app     : ${mine}\n    kontrak : ${theirs}`);
    checked++;
  }
}

if (problems.length) {
  console.error(`ABI TIDAK SINKRON (${problems.length} masalah dari ${checked} entri):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`ABI sinkron dengan WageholdPatronage.sol: ${checked} entri (fungsi + error) cocok.`);
