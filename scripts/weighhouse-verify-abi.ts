/**
 * Memastikan event ABI yang diindeks Weighhouse (lib/weighhouse/events.ts) sama persis dengan
 * ABI hasil compile Foundry (contracts/out). Jalankan: npx tsx scripts/weighhouse-verify-abi.ts
 * Brief §5.1: "Don't guess event signatures."
 */
import { readFileSync } from "node:fs";
import { toEventSelector, type AbiEvent } from "viem";
import { CURVE_EVENTS, POOL_GRADUATED_EVENT, SPLITTER_EVENTS, STRONGBOX_EVENTS, TOKEN_LAUNCHED_EVENT } from "../lib/weighhouse/events";

function load(path: string): AbiEvent[] {
  return (JSON.parse(readFileSync(path, "utf8")).abi as { type: string }[]).filter((x) => x.type === "event") as AbiEvent[];
}

let bad = 0;
for (const [name, mine, path] of [
  ["WageholdStrongbox", STRONGBOX_EVENTS, "contracts/out/WageholdStrongbox.sol/WageholdStrongbox.json"],
  ["WageholdSplitter", SPLITTER_EVENTS, "contracts/out/WageholdSplitter.sol/WageholdSplitter.json"],
] as const) {
  const onChain = new Map(load(path).map((e) => [e.name, toEventSelector(e)]));
  for (const ev of mine) {
    const want = onChain.get(ev.name);
    const got = toEventSelector(ev);
    const ok = want === got;
    if (!ok) bad++;
    console.log(`${ok ? "OK  " : "FAIL"} ${name}.${ev.name} ${ok ? got : `(mine ${got} vs abi ${want ?? "MISSING"})`}`);
  }
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
