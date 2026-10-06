/**
 * Uji logika murni sesi 4B (tanpa jaringan, tanpa wallet, tanpa browser):
 *   npx tsx scripts/test-patronage-4b.ts
 * Mencakup urutan/filter pool, hitungan per 1.000 $WAGE, batch Claim all, total posisi,
 * ABI claimMany, dan pemindaian kata terlarang pada file baru 4B.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PoolView } from "@/lib/patronage-onchain";
import {
  filterPools,
  hasPosition,
  MAX_CLAIM_BATCH,
  parseBase,
  rewardPer1000,
  selectClaimBatch,
  sortPools,
  sumPositions,
  unionBuildingIds,
  type PositionRow,
} from "@/lib/patronage-page";
import { formatWageUnits } from "@/lib/wage-format";
import { patronageAbi } from "@/lib/web3/patronage-abi";
import { findForbiddenWording, PATRONAGE_LABEL } from "@/lib/wording";

const E18 = 10n ** 18n;
let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};

const id = (i: number) => `0x${i.toString(16).padStart(64, "0")}` as `0x${string}`;

function pool(i: number, over: Partial<PoolView> = {}): PoolView {
  return {
    agentId: `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
    chainAgentId: id(i),
    name: `Wright ${i}`,
    code: `W${i}`,
    ward: "research",
    registered: true,
    totalStaked: "0",
    patronCount: 0,
    rewardsTotal: "0",
    redirectedTotal: "0",
    sealed7d: "0",
    jobsSealed7d: 0,
    patronCut7d: "0",
    paidToPatrons7d: "0",
    ...over,
  };
}

const row = (i: number, over: Partial<PositionRow> = {}): PositionRow => ({
  chainAgentId: id(i),
  staked: 0n,
  cooling: 0n,
  unlockAt: 0,
  pending: 0n,
  ...over,
});

t("parseBase: string base unit, pecahan nol, null", () => {
  assert.equal(parseBase("123"), 123n);
  assert.equal(parseBase("123.0"), 123n);
  assert.equal(parseBase(null), 0n);
  assert.equal(parseBase(""), 0n);
  assert.equal(parseBase("1000000000000000000000000000"), 10n ** 27n);
});

t("sortPools: menurun menurut staked, bigint di atas 2^53, seri -> nama", () => {
  const big = (10n ** 27n + 1n).toString();
  const small = (10n ** 27n).toString(); // beda 1 base unit: float akan menganggap sama
  const pools = [
    pool(1, { name: "Zed", totalStaked: small }),
    pool(2, { name: "Amy", totalStaked: small }),
    pool(3, { name: "Mid", totalStaked: big }),
    pool(4, { name: "Low", totalStaked: "5" }),
  ];
  assert.deepEqual(sortPools(pools, "staked").map((p) => p.name), ["Mid", "Amy", "Zed", "Low"]);
});

t("sortPools: wages7d memakai sealed7d, bukan staked; input tidak diubah", () => {
  const pools = [
    pool(1, { name: "A", totalStaked: "900", sealed7d: "10" }),
    pool(2, { name: "B", totalStaked: "100", sealed7d: "50" }),
  ];
  const before = pools.map((p) => p.name).join();
  assert.deepEqual(sortPools(pools, "wages7d").map((p) => p.name), ["B", "A"]);
  assert.deepEqual(sortPools(pools, "staked").map((p) => p.name), ["A", "B"]);
  assert.equal(pools.map((p) => p.name).join(), before);
});

t("filterPools: semua ward, satu ward, ward kosong", () => {
  const pools = [pool(1, { ward: "research" }), pool(2, { ward: "onchain" }), pool(3, { ward: "research" })];
  assert.equal(filterPools(pools, "all").length, 3);
  assert.deepEqual(filterPools(pools, "research").map((p) => p.name), ["Wright 1", "Wright 3"]);
  assert.equal(filterPools(pools, "security").length, 0);
});

t("rewardPer1000: 10 WAGE dibagi ke pool 1.000 WAGE -> 10 WAGE per 1.000", () => {
  const r = rewardPer1000((10n * E18).toString(), (1000n * E18).toString(), 18);
  assert.equal(r, 10n * E18);
  assert.equal(formatWageUnits(r!), "10 WAGE");
});

t("rewardPer1000: pecahan tidak hilang (rumus lama notified*1000/staked membulatkan ke 0)", () => {
  const paid = (E18 / 2n).toString(); // 0,5 WAGE
  const staked = (1000n * E18).toString();
  const r = rewardPer1000(paid, staked, 18);
  assert.equal(formatWageUnits(r!, { maxFraction: 2 }), "0.5 WAGE");
  // Rumus di lib/patronage-onchain.ts: notified * 1000 / staked -> bilangan bulat WAGE utuh
  const apiValue = (BigInt(paid) * 1000n) / BigInt(staked);
  assert.equal(apiValue, 0n);
});

t("rewardPer1000: tanpa stake -> null; desimal token bukan 18", () => {
  assert.equal(rewardPer1000("500", "0", 18), null);
  // token 6 desimal: 2 WAGE dibagi ke pool 500 WAGE -> 4 WAGE per 1.000
  const r = rewardPer1000("2000000", "500000000", 6);
  assert.equal(formatWageUnits(r!, { decimals: 6 }), "4 WAGE");
});

t("sumPositions: total, jumlah bangunan, unlock paling awal", () => {
  const tot = sumPositions([
    row(1, { staked: 5n * E18, pending: 2n * E18 }),
    row(2, { cooling: 3n * E18, unlockAt: 2_000_000_000 }),
    row(3, { staked: 1n * E18, cooling: 1n * E18, unlockAt: 1_900_000_000 }),
    row(4),
  ]);
  assert.equal(tot.staked, 6n * E18);
  assert.equal(tot.cooling, 4n * E18);
  assert.equal(tot.pending, 2n * E18);
  assert.equal(tot.stakedBuildings, 2);
  assert.equal(tot.claimableBuildings, 1);
  assert.equal(tot.nextUnlockAt, 1_900_000_000);
  assert.equal(sumPositions([]).nextUnlockAt, null);
});

t("hasPosition: stake, cooldown, atau reward saja sudah cukup", () => {
  assert.equal(hasPosition(row(1)), false);
  assert.equal(hasPosition(row(1, { staked: 1n })), true);
  assert.equal(hasPosition(row(1, { cooling: 1n })), true);
  assert.equal(hasPosition(row(1, { pending: 1n })), true); // sudah unstake penuh, reward masih menunggu
});

t("selectClaimBatch: hanya pending > 0, terbesar dulu, jumlah benar", () => {
  const b = selectClaimBatch([row(1, { pending: 2n }), row(2), row(3, { pending: 9n }), row(4, { staked: 7n })]);
  assert.deepEqual(b.ids, [id(3), id(1)]);
  assert.equal(b.total, 11n);
  assert.equal(b.remaining, 0);
});

t("selectClaimBatch: kosong, duplikat, dan batas batch", () => {
  assert.deepEqual(selectClaimBatch([]).ids, []);
  assert.equal(selectClaimBatch([row(1), row(2, { staked: 1n })]).total, 0n);

  const dup = selectClaimBatch([row(1, { pending: 5n }), row(1, { pending: 5n })]);
  assert.equal(dup.ids.length, 1);
  assert.equal(dup.total, 5n);

  const many = Array.from({ length: MAX_CLAIM_BATCH + 5 }, (_, i) => row(i + 1, { pending: BigInt(i + 1) }));
  const capped = selectClaimBatch(many);
  assert.equal(capped.ids.length, MAX_CLAIM_BATCH);
  assert.equal(capped.remaining, 5);
  // yang tertinggal adalah yang terkecil
  assert.ok(!capped.ids.includes(id(1)));
  assert.ok(capped.ids.includes(id(MAX_CLAIM_BATCH + 5)));
  assert.equal(selectClaimBatch(many, 2).remaining, many.length - 2);
});

t("unionBuildingIds: gabung tanpa duplikat, huruf kecil, buang yang bukan bytes32", () => {
  const upper = id(10).toUpperCase().replace("0X", "0x");
  const out = unionBuildingIds([id(1), id(2)], [upper, id(10), "0x1234", "nope"], [id(1)]);
  assert.deepEqual(out, [id(1), id(2), id(10)]);
});

t("ABI: claimMany(bytes32[]) ada dan nonpayable", () => {
  const f = patronageAbi.find((x) => x.type === "function" && x.name === "claimMany");
  assert.ok(f && f.type === "function");
  assert.equal(f.stateMutability, "nonpayable");
  assert.deepEqual(f.inputs.map((i) => i.type), ["bytes32[]"]);
});

t("label: caption historis persis \"Past 7 days, not a forecast\"", () => {
  assert.equal(PATRONAGE_LABEL.historical, "Past 7 days, not a forecast");
  assert.equal(PATRONAGE_LABEL.claimAll, "Claim all");
});

t("kata terlarang: file 4B yang tampil ke user bersih dari APR/APY/yield", () => {
  const files = [
    "components/patronage/patronage-client.tsx",
    "components/patronage/position-panel.tsx",
    "components/patronage/use-my-position.ts",
    "app/patronage/page.tsx",
    "components/tx-status.tsx",
    "lib/patronage-page.ts",
  ];
  for (const f of files) {
    const hits = findForbiddenWording(readFileSync(f, "utf8"));
    assert.deepEqual(hits, [], `${f} memuat kata terlarang: ${hits.join(", ")}`);
  }
});

console.log(`\n${n} kelompok uji lulus.`);
