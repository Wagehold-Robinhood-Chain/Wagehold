/**
 * Uji logika murni sesi 4C (tanpa jaringan, wallet, browser, atau Supabase):
 *   npx tsx scripts/test-patronage-4c.ts
 * Mencakup: cincin patron, konversi base unit, hitungan supply (Patronage bukan "Circulating"), kecocokan event
 * app vs kontrak (source Solidity), label ledger Patronage, isi migrasi 0019, dan pemindaian kata terlarang.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  baseToWage,
  ledgerHint,
  patronBuildingIds,
  PATRONAGE_LEDGER_HINT,
  sameSet,
  type StakeRead,
} from "@/lib/patronage-city";
import { bucketSum, circulatingSupply, type SupplyBalances } from "@/lib/weighhouse/supply-math";
import { compareEvents, parseEventsTs, parseSolEvents, sigString } from "@/lib/weighhouse/sol-events";
import { findForbiddenWording } from "@/lib/wording";

const E18 = 10n ** 18n;
let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};
const read = (p: string) => readFileSync(p, "utf8");

// ---- 1. cincin patron --------------------------------------------------------------------------
t("patronBuildingIds: hanya stake > 0", () => {
  const reads: StakeRead[] = [
    { agentId: "a", staked: 5n * E18 },
    { agentId: "b", staked: 0n },
    { agentId: "c", staked: 1n },
  ];
  assert.deepEqual([...patronBuildingIds(reads)].sort(), ["a", "c"]);
});
t("patronBuildingIds: unstake penuh menghapus cincin", () => {
  const prev = new Set(["a"]);
  assert.equal(patronBuildingIds([{ agentId: "a", staked: 0n }], prev).size, 0);
});
t("patronBuildingIds: bacaan gagal mempertahankan status sebelumnya (tidak berkedip)", () => {
  const prev = new Set(["a"]);
  const next = patronBuildingIds(
    [
      { agentId: "a", staked: null },
      { agentId: "b", staked: null },
    ],
    prev,
  );
  assert.deepEqual([...next], ["a"]); // a tetap; b gagal tapi memang belum patron
});
t("patronBuildingIds: bangunan yang tidak lagi ada di daftar gugur", () => {
  const next = patronBuildingIds([{ agentId: "x", staked: 1n }], new Set(["gone"]));
  assert.deepEqual([...next], ["x"]);
});
t("patronBuildingIds: tanpa bangunan -> kosong", () => {
  assert.equal(patronBuildingIds([]).size, 0);
});
t("sameSet", () => {
  assert.ok(sameSet(new Set(["a", "b"]), new Set(["b", "a"])));
  assert.ok(!sameSet(new Set(["a"]), new Set(["a", "b"])));
  assert.ok(!sameSet(new Set(["a", "c"]), new Set(["a", "b"])));
  assert.ok(sameSet(new Set(), new Set()));
});

// ---- 2. base unit -> WAGE -----------------------------------------------------------------------
t("baseToWage", () => {
  assert.equal(baseToWage("1000000000000000000"), 1);
  assert.equal(baseToWage("500000000000000000"), 0.5);
  assert.equal(baseToWage("0"), 0);
  assert.equal(baseToWage(null), 0);
  assert.equal(baseToWage(undefined), 0);
  assert.equal(baseToWage("2000000000000000000.0"), 2); // numeric::text boleh membawa ".0"
  assert.equal(baseToWage("123456789000000000000000000"), 123456789); // di atas 2^53 base unit tetap benar
  assert.equal(baseToWage("abc"), 0); // sampah -> 0, bukan NaN/throw
  assert.equal(baseToWage("1500000", 6), 1.5); // desimal token lain
});

// ---- 3. supply ----------------------------------------------------------------------------------
const base: SupplyBalances = {
  total: 1_000_000n * E18,
  burned: 10_000n * E18,
  curve: 0n,
  lp: 200_000n * E18,
  locker: 100_000n * E18,
  strongbox: 5_000n * E18,
  splitter: 1_000n * E18,
  treasuries: 4_000n * E18,
  patronage: 0n,
};
t("circulatingSupply: tanpa Patronage sama dengan rumus lama", () => {
  const old = base.total - base.burned - base.curve - base.locker - (base.lp ?? 0n) - base.strongbox - base.splitter - base.treasuries;
  assert.equal(circulatingSupply(base), old);
});
t("circulatingSupply: $WAGE yang di-stake bukan Circulating", () => {
  const staked = { ...base, patronage: 30_000n * E18 };
  assert.equal(circulatingSupply(base) - circulatingSupply(staked), 30_000n * E18);
});
t("bucketSum == total (bucket + circulating menutup supply)", () => {
  for (const b of [base, { ...base, patronage: 12_345n * E18, lp: null }, { ...base, strongbox: 0n, splitter: 0n }]) {
    assert.equal(bucketSum(b, circulatingSupply(b)), b.total);
  }
});
t("circulatingSupply: lp null dihitung 0 (sama dengan perilaku lama)", () => {
  assert.equal(circulatingSupply({ ...base, lp: null }) - circulatingSupply(base), 200_000n * E18);
});

// ---- 4. event app vs kontrak ---------------------------------------------------------------------
const eventsTs = read("lib/weighhouse/events.ts");
const sol = (f: string) => parseSolEvents(read(`contracts/src/${f}.sol`));
for (const [label, arr, file] of [
  ["Strongbox v1", "STRONGBOX_EVENTS", "WageholdStrongbox"],
  ["Splitter v1", "SPLITTER_EVENTS", "WageholdSplitter"],
  ["Strongbox v2", "STRONGBOX_EVENTS", "WageholdStrongboxV2"],
  ["Splitter v2", "SPLITTER_V2_EVENTS", "WageholdSplitterV2"],
  ["Patronage", "PATRONAGE_EVENTS", "WageholdPatronage"],
] as const) {
  t(`event ${label} == ${file}.sol`, () => {
    const mine = parseEventsTs(eventsTs, arr);
    assert.ok(mine.length >= 3, `${arr} terbaca`);
    assert.deepEqual(compareEvents(label, mine, sol(file)), []);
  });
}
t("pembanding event benar-benar bisa gagal (tipe, indexed, nama, event hilang)", () => {
  const s = sol("WageholdPatronage");
  const mine = parseEventsTs(eventsTs, "PATRONAGE_EVENTS");
  const clone = (f: (e: ReturnType<typeof parseEventsTs>) => void) => {
    const c = structuredClone(mine);
    f(c);
    return compareEvents("x", c, s);
  };
  assert.equal(clone((c) => (c[0].args[2].type = "uint128")).length, 1); // tipe
  assert.equal(clone((c) => (c[0].args[1].indexed = false)).length, 1); // indexed
  assert.equal(clone((c) => (c[4].args[2].name = "total")).length, 1); // nama argumen
  assert.equal(clone((c) => c.push({ name: "Nope", args: [] })).length, 1); // event tidak ada di kontrak
  assert.ok(sigString(mine[0]).startsWith("Staked(bytes32 indexed agentId"));
});
t("Splitter v2 TIDAK sama dengan v1 (alasan keduanya didaftarkan terpisah)", () => {
  const v1 = parseEventsTs(eventsTs, "SPLITTER_EVENTS");
  assert.ok(compareEvents("v1-vs-v2", v1, sol("WageholdSplitterV2")).length > 0);
});

// ---- 5. ledger Patronage ---------------------------------------------------------------------------
t("ledger: tiga event Patronage masuk daftar dan punya label", () => {
  assert.match(eventsTs, /PATRONAGE_LEDGER_EVENT_NAMES: string\[\] = \["Staked", "RewardNotified", "RewardRedirected"\]/);
  const def = /export const LEDGER_EVENT_NAMES[\s\S]*?\];/.exec(eventsTs)?.[0] ?? "";
  assert.match(def, /PATRONAGE_LEDGER_EVENT_NAMES/);
  for (const [ev, kind] of [
    ["Staked", "Staked"],
    ["RewardNotified", "Patron reward"],
    ["RewardRedirected", "Redirected"],
  ]) {
    assert.match(eventsTs, new RegExp(`${ev}: "${kind}"`));
    assert.ok(ledgerHint(kind), `hint ${kind}`);
  }
  const pat = parseEventsTs(eventsTs, "PATRONAGE_EVENTS").map((e) => e.name);
  for (const ev of ["Staked", "RewardNotified", "RewardRedirected"]) assert.ok(pat.includes(ev));
  assert.equal(ledgerHint("Sealed"), undefined);
  assert.equal(Object.keys(PATRONAGE_LEDGER_HINT).length, 3);
});

// ---- 6. migrasi 0019 -------------------------------------------------------------------------------
const mig = read("supabase/migrations/0019_weighhouse_patronage.sql").replace(/--.*$/gm, "");
t("migrasi 0019: kolom patronage, fungsi diganti (drop + create), staked dari building_pools", () => {
  assert.match(mig, /alter table supply_snapshots add column if not exists patronage numeric\(78,0\)/);
  assert.match(mig, /drop function if exists weighhouse_top_buildings\(timestamptz, int\)/);
  assert.match(mig, /create function weighhouse_top_buildings/);
  assert.match(mig, /staked text/);
  assert.match(mig, /from building_pools bp where bp\.agent_id = a\.chain_agent_id/);
  assert.match(mig, /grant execute on function weighhouse_top_buildings\(timestamptz, int\) to service_role/);
});
t("migrasi 0019: tidak menyentuh tabel simulasi (dibekukan di 4D)", () => {
  assert.doesNotMatch(mig, /\bstakes\b|stake_payouts|record_wage_split|wage_splits/);
});

// ---- 7. sumber lama sudah lepas ---------------------------------------------------------------------
t("metrics/dashboard/profil tidak lagi membaca tabel simulasi untuk angka stake", () => {
  const metrics = read("lib/weighhouse/metrics.ts");
  assert.doesNotMatch(metrics, /from\('stakes'\)|sumStakes|stakedByPatrons/);
  assert.match(metrics, /rpc\('patronage_totals'\)/);
  assert.match(metrics, /'patronage'/); // bucket baru
  const dash = read("components/realtime-city-dashboard.tsx");
  assert.doesNotMatch(dash, /summarizeStakes|useRealtimeChanges\('stakes'/);
  assert.match(dash, /usePatronBuildings/);
  assert.match(dash, /patronIds=\{patronIds\}/);
  assert.doesNotMatch(read("app/agents/[id]/page.tsx"), /summarizeStakes|listStakes/);
  assert.doesNotMatch(read("components/weighhouse/weighhouse-client.tsx"), /\(simulation\)|\(sim\)|off-chain until/);
});
t("supply.ts: v2 + Patronage ikut dibaca, alamat kosong = 0 (bukan totalSupply)", () => {
  const s = read("lib/weighhouse/supply.ts");
  assert.match(s, /PATRONAGE\.strongboxV2/);
  assert.match(s, /PATRONAGE\.splitterV2/);
  assert.match(s, /PATRONAGE\.patronage/);
  assert.match(s, /Promise\.resolve\(0n\)/);
  assert.match(s, /patronage: patronage\.toString\(\)/);
});
t("city-scene: cincin dibuat per gedung, dianimasikan, dan didukung reduced motion", () => {
  const c = read("components/city-scene.tsx");
  assert.match(c, /new THREE\.TorusGeometry/);
  assert.match(c, /patronRef\.current\.has\(b\.agentId\)/);
  assert.match(c, /ring,\n\s+ringK: 0,/);
  assert.match(c, /reduceMotion\s*\n?\s*\? ringWant/);
});

// ---- 8. kata terlarang (Dev Brief §10) --------------------------------------------------------------
t("tidak ada APR/APY/yield di file 4C yang menghadap user", () => {
  for (const f of [
    "lib/patronage-city.ts",
    "lib/web3/use-patron-buildings.ts",
    "components/patronage/use-onchain-pools.ts",
    "components/weighhouse/weighhouse-client.tsx",
    "components/city-scene.tsx",
    "components/realtime-city-dashboard.tsx",
    "lib/weighhouse/metrics.ts",
    "lib/weighhouse/events.ts",
    "supabase/migrations/0019_weighhouse_patronage.sql",
  ]) {
    assert.deepEqual(findForbiddenWording(read(f)), [], f);
  }
});

console.log(`\n${n} kelompok uji lulus`);
