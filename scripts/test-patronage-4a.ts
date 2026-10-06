/**
 * Uji logika murni sesi 4A (tanpa jaringan, tanpa wallet):
 *   npx tsx scripts/test-patronage-4a.ts
 * Mencakup format/parse $WAGE, pengecekan stake/unstake, durasi cooldown, dan aturan kata.
 */
import assert from "node:assert/strict";
import { formatWageExact, formatWageUnits, parseWageInput, toInputString } from "@/lib/wage-format";
import {
  checkStake,
  checkUnstake,
  cooldownRemaining,
  describeCooldown,
  formatDuration,
  maxStakeable,
} from "@/lib/web3/patronage-rules";
import { findForbiddenWording, PATRONAGE_LABEL } from "@/lib/wording";

const E18 = 10n ** 18n;
let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};

t("format: biasa, ribuan, pecahan dipotong bukan dibulatkan", () => {
  assert.equal(formatWageUnits(1844n * E18 + E18 / 4n), "1,844.25 WAGE");
  assert.equal(formatWageUnits(0n), "0 WAGE");
  assert.equal(formatWageUnits(1_000_000n * E18), "1,000,000 WAGE");
  // 1.999 -> 1.99 (dipotong), jangan pernah 2.00
  assert.equal(formatWageUnits(1999n * 10n ** 15n), "1.99 WAGE");
});

t("format: jumlah kecil tidak tampil 0", () => {
  assert.equal(formatWageUnits(1n), "<0.01 WAGE");
  assert.equal(formatWageUnits(5n * 10n ** 15n, { maxFraction: 4 }), "0.005 WAGE");
  assert.equal(formatWageUnits(1n, { maxFraction: 4 }), "<0.0001 WAGE");
});

t("format: desimal token bukan 18 (mock 6 desimal)", () => {
  assert.equal(formatWageUnits(1_500_000n, { decimals: 6 }), "1.5 WAGE");
  assert.equal(formatWageUnits(1_500_000n, { decimals: 6, withUnit: false }), "1.5");
});

t("format: presisi penuh & input string bolak-balik", () => {
  const raw = 123n * E18 + 456789n;
  assert.equal(formatWageExact(raw), "123.000000000000456789 WAGE");
  assert.equal(toInputString(raw), "123.000000000000456789");
  assert.equal(toInputString(5n * E18), "5");
});

t("parse: input valid", () => {
  assert.deepEqual(parseWageInput("100"), { ok: true, value: 100n * E18 });
  assert.deepEqual(parseWageInput(" 1,000.5 "), { ok: true, value: 1000n * E18 + E18 / 2n });
  assert.deepEqual(parseWageInput(".5"), { ok: true, value: E18 / 2n });
  assert.deepEqual(parseWageInput("1.5", 6), { ok: true, value: 1_500_000n });
});

t("parse: input tidak valid ditolak dengan pesan", () => {
  for (const bad of ["", "   ", "0", "0.0", "-5", "1e3", "abc", ".", "1.2.3", "5 WAGE"]) {
    const r = parseWageInput(bad);
    assert.equal(r.ok, false, `harus ditolak: "${bad}"`);
    if (!r.ok) assert.ok(r.error.length > 0);
  }
  assert.equal(parseWageInput("1.1234567", 6).ok, false); // terlalu banyak desimal
  // 18 desimal masih boleh, 19 tidak
  assert.equal(parseWageInput("0." + "1".repeat(18)).ok, true);
  assert.equal(parseWageInput("0." + "1".repeat(19)).ok, false);
});

const base = {
  amount: 100n * E18,
  balance: 500n * E18,
  staked: 0n,
  minStake: 10n * E18,
  maxStakePerUser: 0n,
  registered: true,
  paused: false,
  decimals: 18,
};

t("checkStake: lolos dan semua penolakan", () => {
  assert.equal(checkStake(base), null);
  assert.match(checkStake({ ...base, registered: false }) ?? "", /isn't open/);
  assert.match(checkStake({ ...base, paused: true }) ?? "", /paused/);
  assert.match(checkStake({ ...base, amount: 0n }) ?? "", /greater than 0/);
  assert.match(checkStake({ ...base, amount: 5n * E18 }) ?? "", /minimum stake is 10 WAGE/);
  assert.match(checkStake({ ...base, amount: 600n * E18 }) ?? "", /wallet has 500 WAGE/);
  // batas per patron: sudah 80, batas 100, tambah 30 -> ditolak, sisa 20
  const capped = checkStake({ ...base, staked: 80n * E18, maxStakePerUser: 100n * E18, amount: 30n * E18 });
  assert.match(capped ?? "", /20 WAGE more/);
  assert.equal(checkStake({ ...base, staked: 80n * E18, maxStakePerUser: 100n * E18, amount: 20n * E18 }), null);
});

t("checkUnstake & maxStakeable", () => {
  assert.equal(checkUnstake({ amount: 5n * E18, staked: 5n * E18, decimals: 18 }), null);
  assert.match(checkUnstake({ amount: 6n * E18, staked: 5n * E18, decimals: 18 }) ?? "", /5 WAGE staked/);
  assert.equal(maxStakeable(500n * E18, 0n, 0n), 500n * E18);
  assert.equal(maxStakeable(500n * E18, 80n * E18, 100n * E18), 20n * E18);
  assert.equal(maxStakeable(10n * E18, 80n * E18, 100n * E18), 10n * E18);
  assert.equal(maxStakeable(500n * E18, 120n * E18, 100n * E18), 0n);
});

t("cooldown: sisa waktu & format durasi", () => {
  assert.equal(cooldownRemaining(1_000, 400_000), 600);
  assert.equal(cooldownRemaining(1_000, 2_000_000), 0);
  assert.equal(cooldownRemaining(0n, Date.now()), 0);
  assert.equal(formatDuration(20), "under a minute");
  assert.equal(formatDuration(90), "2m");
  assert.equal(formatDuration(4_500), "1h 15m");
  assert.equal(formatDuration(7_199), "2h"); // 1h59m59s -> naik ke 2h, bukan "1h"
  assert.equal(formatDuration(273_600), "3d 4h");
  assert.equal(formatDuration(259_200), "3d");
  assert.equal(describeCooldown(259_200), "3 days");
  assert.equal(describeCooldown(86_400), "1 day");
  assert.equal(describeCooldown(43_200), "12 hours");
});

t("aturan kata: istilah terlarang terdeteksi, label resmi bersih", () => {
  assert.deepEqual(findForbiddenWording("Earn 12% APY on your stake"), ["APY"]);
  assert.deepEqual(findForbiddenWording("high yield, APR and yields"), ["yield", "APR", "yields"]);
  assert.deepEqual(findForbiddenWording("Past 7 days, not a forecast"), []);
  assert.deepEqual(findForbiddenWording("The aprons are ready"), []); // bukan "apr" utuh
  for (const label of Object.values(PATRONAGE_LABEL)) {
    assert.deepEqual(findForbiddenWording(label), [], label);
  }
});

console.log(`\n${n} kelompok uji lulus.`);
