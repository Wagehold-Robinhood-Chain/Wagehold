/**
 * Memastikan event ABI yang diindeks Weighhouse (lib/weighhouse/events.ts) sama persis dengan
 * ABI hasil compile Foundry (contracts/out). Jalankan: npx tsx scripts/weighhouse-verify-abi.ts
 * Brief §5.1: "Don't guess event signatures."
 */
import { existsSync, readFileSync } from "node:fs";
import { toEventSelector, type AbiEvent } from "viem";
import { CURVE_EVENTS, POOL_GRADUATED_EVENT, SPLITTER_EVENTS, STRONGBOX_EVENTS, TOKEN_LAUNCHED_EVENT } from "../lib/weighhouse/events";
import { compareEvents, parseEventsTs, parseSolEvents } from "../lib/weighhouse/sol-events";

function load(path: string): AbiEvent[] {
  return (JSON.parse(readFileSync(path, "utf8")).abi as { type: string }[]).filter((x) => x.type === "event") as AbiEvent[];
}

let bad = 0;
for (const [name, mine, path] of [
  ["WageholdStrongbox", STRONGBOX_EVENTS, "contracts/out/WageholdStrongbox.sol/WageholdStrongbox.json"],
  ["WageholdSplitter", SPLITTER_EVENTS, "contracts/out/WageholdSplitter.sol/WageholdSplitter.json"],
] as const) {
  if (!existsSync(path)) {
    // Tanpa `forge build`: pemeriksaan teks di bawah (v1, v2, Patronage) tetap berjalan.
    console.log(`SKIP ${name}: ${path} belum ada (jalankan forge build untuk pemeriksaan selector dari ABI hasil compile)`);
    continue;
  }
  const onChain = new Map(load(path).map((e) => [e.name, toEventSelector(e)]));
  for (const ev of mine) {
    const want = onChain.get(ev.name);
    const got = toEventSelector(ev);
    const ok = want === got;
    if (!ok) bad++;
    console.log(`${ok ? "OK  " : "FAIL"} ${name}.${ev.name} ${ok ? got : `(mine ${got} vs abi ${want ?? "MISSING"})`}`);
  }
}
// Dari SOURCE Solidity (tanpa forge build): v1, Strongbox/Splitter v2, dan Patronage (Tahap 4C). Membandingkan nama,
// tipe, `indexed`, dan nama argumen -- indexer membaca `args.<nama>`, jadi nama harus sama, bukan hanya topic0.
const eventsTs = readFileSync("lib/weighhouse/events.ts", "utf8");
const sol = (file: string) => parseSolEvents(readFileSync(`contracts/src/${file}.sol`, "utf8"));
for (const [label, arr, file] of [
  ["Strongbox v1", "STRONGBOX_EVENTS", "WageholdStrongbox"],
  ["Splitter v1", "SPLITTER_EVENTS", "WageholdSplitter"],
  ["Strongbox v2", "STRONGBOX_EVENTS", "WageholdStrongboxV2"], // ABI event Strongbox v2 identik dengan v1 (dipakai ulang)
  ["Splitter v2", "SPLITTER_V2_EVENTS", "WageholdSplitterV2"],
  ["Patronage", "PATRONAGE_EVENTS", "WageholdPatronage"],
] as const) {
  const mine = parseEventsTs(eventsTs, arr);
  const problems = compareEvents(label, mine, sol(file));
  for (const p of problems) console.log(`FAIL ${p}`);
  if (!problems.length) console.log(`OK   ${label}: ${mine.length} event cocok dengan ${file}.sol`);
  bad += problems.length;
}

// Event Pons V2: topic0 yang dipublikasikan dokumentasi Bitquery (pons-api, "Event reference").
// Tidak ada ABI Foundry lokal untuk kontrak Pons, jadi pembandingnya adalah hash terbitan itu.
const PONS_TOPICS: Record<string, string> = {
  TokenLaunched: "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607",
  PoolGraduated: "0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259",
  CurveBuy: "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455",
  CurveSell: "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df",
};
for (const ev of [TOKEN_LAUNCHED_EVENT, POOL_GRADUATED_EVENT, ...CURVE_EVENTS]) {
  const got = toEventSelector(ev);
  const ok = PONS_TOPICS[ev.name] === got;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "FAIL"} Pons.${ev.name} ${ok ? got : `(mine ${got} vs docs ${PONS_TOPICS[ev.name]})`}`);
}
process.exit(bad ? 1 : 0);
