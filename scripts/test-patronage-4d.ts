/**
 * Uji sesi 4D (tanpa jaringan, wallet, browser, atau Supabase):
 *   npx tsx scripts/test-patronage-4d.ts
 * Mencakup: Counting House dari chain (konversi), ringkasan Simulation history, isi migrasi 0020, bukti kode
 * simulasi sudah lepas, dan audit kata terlarang seluruh proyek (§10), termasuk bukti auditnya bisa gagal.
 * Perilaku SQL migrasi 0020 diuji terpisah terhadap Postgres sungguhan (lihat PATRONAGE_4D.md).
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCountingHouse } from "@/lib/counting-house";
import { hasSimulationHistory, summarizeSimulation } from "@/lib/simulation-history";
import { ledgerSentence, shortWallet } from "@/lib/patronage-city";
import { findForbiddenWording } from "@/lib/wording";
import { scanWording } from "./wording-audit-lib";

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};
const read = (p: string) => readFileSync(p, "utf8");
const E18 = 10n ** 18n;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "contracts"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}
const appSources = () =>
  [...walk(".")].filter((f) => !/^scripts[\\/]test-/.test(f) && !f.endsWith("tsbuildinfo"));

// ---- 1. Counting House dari chain --------------------------------------------------------------
t("parseCountingHouse: base unit -> WAGE, total dari SQL", () => {
  const r = parseCountingHouse({
    tithe: String(150n * E18 + E18 / 2n),
    redirected: String(7n * E18 + E18 / 2n),
    total: String(158n * E18),
  });
  assert.equal(r.tithe, 150.5);
  assert.equal(r.redirected, 7.5);
  assert.equal(r.total, 158);
});
t("parseCountingHouse: total hilang -> dijumlahkan; bentuk aneh -> nol, tidak melempar", () => {
  assert.equal(parseCountingHouse({ tithe: String(2n * E18), redirected: String(E18) }).total, 3);
  assert.deepEqual(parseCountingHouse(null), { tithe: 0, redirected: 0, total: 0 });
  assert.deepEqual(parseCountingHouse("x"), { tithe: 0, redirected: 0, total: 0 });
  assert.deepEqual(parseCountingHouse({ tithe: "abc" }), { tithe: 0, redirected: 0, total: 0 });
});
t("parseCountingHouse: angka di atas 2^53 base unit tetap benar (presisi bigint)", () => {
  const r = parseCountingHouse({ tithe: String(123_456_789n * E18 + 5n * 10n ** 17n), redirected: "0", total: String(123_456_789n * E18 + 5n * 10n ** 17n) });
  assert.equal(r.total, 123_456_789.5);
});

// ---- 2. Simulation history ---------------------------------------------------------------------
t("summarizeSimulation: patron, stake, rewards (termasuk yang sudah menarik stake), baris pengunjung", () => {
  const rows = [
    { staker_id: "sim:a", amount: 150, earned: "200.000000" },
    { staker_id: "sim:b", amount: "300", earned: 400 },
    { staker_id: "sim:c", amount: 0, earned: 25 }, // sudah menarik semua stake
  ];
  const s = summarizeSimulation(rows, "sim:a");
  assert.equal(s.patrons, 2);
  assert.equal(s.staked, 450);
  assert.equal(s.earned, 625);
  assert.deepEqual(s.mine, { staked: 150, earned: 200 });
  assert.equal(summarizeSimulation(rows, "sim:c").mine?.earned, 25);
  assert.equal(summarizeSimulation(rows, "sim:zzz").mine, null);
  assert.equal(summarizeSimulation(rows, null).mine, null);
});
t("hasSimulationHistory: bangunan tanpa jejak simulasi tidak menampilkan bagian ini", () => {
  assert.equal(hasSimulationHistory(summarizeSimulation([], "sim:a")), false);
  assert.equal(hasSimulationHistory(summarizeSimulation([{ staker_id: "x", amount: 0, earned: 0 }], "x")), false);
  assert.equal(hasSimulationHistory(summarizeSimulation([{ staker_id: "x", amount: 1, earned: 0 }], null)), true);
  assert.equal(hasSimulationHistory(summarizeSimulation([{ staker_id: "x", amount: 0, earned: 3 }], null)), true);
});
t("SimulationHistory: hanya-baca (tidak ada insert/update/rpc) dan terpasang di kedua profil", () => {
  const c = read("components/simulation-history.tsx");
  assert.doesNotMatch(c, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  assert.match(c, /\.from\('stakes'\)/);
  assert.match(read("components/agent-profile.tsx"), /<SimulationHistory agentId=\{agent\.id\}/);
  assert.match(read("components/wright-profile-panel.tsx"), /<SimulationHistory agentId=\{agent\.id\}/);
});

// ---- 3. migrasi 0020 -----------------------------------------------------------------------------
const mig = read("supabase/migrations/0020_patronage_cutover.sql").replace(/--.*$/gm, "");
t("migrasi 0020: stakes dan stake_payouts dibekukan untuk INSERT, UPDATE, TRUNCATE; DELETE tidak diblokir", () => {
  for (const tbl of ["stakes", "stake_payouts"]) {
    assert.match(mig, new RegExp(`create trigger ${tbl}_frozen\\s+before insert or update on ${tbl}`));
    assert.match(mig, new RegExp(`create trigger ${tbl}_frozen_truncate\\s+before truncate on ${tbl}`));
  }
  assert.doesNotMatch(mig, /before[^;]*\bdelete\b[^;]*on (stakes|stake_payouts)/i); // cascade dari agents / jobs harus lolos
});
t("migrasi 0020: stake_wage / unstake_wage dihapus, tabel TIDAK di-drop", () => {
  assert.match(mig, /drop function if exists stake_wage\(text, uuid, numeric\)/);
  assert.match(mig, /drop function if exists unstake_wage\(text, uuid, numeric\)/);
  assert.doesNotMatch(mig, /drop table/i);
});
t("migrasi 0020: record_wage_split baru tidak menyentuh stakes / stake_payouts dan tanda tangannya tetap", () => {
  const m = mig.match(/create or replace function record_wage_split\([\s\S]*?end \$\$;/);
  assert.ok(m, "record_wage_split tidak ditemukan");
  const body = m![0];
  assert.match(body, /p_job_id uuid,\s*p_patrons_pct numeric,\s*p_lamp_oil_pct numeric,\s*p_tithe_pct numeric,\s*p_furnace_pct numeric/);
  assert.doesNotMatch(body, /\bstakes\b|stake_payouts/);
  assert.match(body, /if exists \(select 1 from wage_splits where job_id = p_job_id\)/); // idempoten
  assert.match(body, /values \(p_job_id, j\.agent_id, gross, patrons, lamp, tithe, furnace, 0, 0\)/);
  assert.match(mig, /grant execute on function record_wage_split\(uuid, numeric, numeric, numeric, numeric\) to service_role/);
});
t("migrasi 0020: counting_house_totals dari JobSplit.titheAmount + RewardRedirected, hanya service_role", () => {
  const m = mig.match(/create or replace function counting_house_totals\(\)[\s\S]*?\$\$;/);
  assert.ok(m, "counting_house_totals tidak ditemukan");
  assert.match(m![0], /titheAmount/);
  assert.match(m![0], /event = 'JobSplit'/);
  assert.match(m![0], /event = 'RewardRedirected'/);
  assert.doesNotMatch(m![0], /wage_splits/);
  assert.match(mig, /revoke all on function counting_house_totals\(\) from public, anon, authenticated/);
  assert.match(mig, /grant execute on function counting_house_totals\(\) to service_role/);
});
t("migrasi 0020: penanda cut-over satu baris, dapat dibaca publik, tidak dapat ditulis browser", () => {
  assert.match(mig, /id boolean primary key default true check \(id\)/);
  assert.match(mig, /revoke insert, update, delete, truncate on table public\.patronage_cutover from anon, authenticated/);
});

// ---- 4. kode simulasi sudah lepas ---------------------------------------------------------------------
t("lib/patronage.ts dan route stake simulasi sudah dihapus", () => {
  assert.equal(existsSync("lib/patronage.ts"), false);
  assert.equal(existsSync("app/api/agents/[id]/stake/route.ts"), false);
});
t("tidak ada import '@/lib/patronage' atau pemanggil stake_wage / unstake_wage / patrons_paid di kode", () => {
  for (const f of appSources()) {
    const s = read(f);
    assert.doesNotMatch(s, /from ['"]@\/lib\/patronage['"]/, f);
    assert.doesNotMatch(s, /\bstake_wage\b|\bunstake_wage\b|patrons_paid|MAX_STAKE_PER/, f);
  }
});
t("tabel simulasi hanya dibaca satu tempat: SimulationHistory (plus tipe)", () => {
  const users = appSources().filter((f) => /from\(['"](stakes|stake_payouts)['"]\)/.test(read(f)));
  assert.deepEqual(users.map((f) => f.split("\\").join("/")), ["components/simulation-history.tsx"]);
});
t("queries.ts: fungsi simulasi hilang, Counting House dari rpc(counting_house_totals)", () => {
  const q = read("lib/supabase/queries.ts");
  assert.doesNotMatch(q, /listStakes|listPayoutsByStaker|getWageSplitTotals|treasury_redirect|stakerCount/);
  assert.match(q, /rpc\('counting_house_totals'\)/);
  assert.match(q, /getBurnedTotal/);
});
t("dashboard kota: tanpa 'You earned' / stake_payouts, Counting House dipolling dari /api/counting-house", () => {
  const d = read("components/realtime-city-dashboard.tsx");
  assert.doesNotMatch(d, /stake_payouts|You<\/b> earned|initialPayouts|payouts/);
  assert.match(d, /fetch\('\/api\/counting-house'\)/);
  assert.match(d, /totals\.treasury === null/);
  assert.doesNotMatch(d, /treasury_redirect|row\.tithe/);
  assert.match(read("app/page.tsx"), /getCountingHouse\(createServiceRoleClient\(\)\)/);
});
t("route /api/counting-house: service role, 503 saat gagal, tanpa tulis", () => {
  const r = read("app/api/counting-house/route.ts");
  assert.match(r, /createServiceRoleClient/);
  assert.match(r, /status: 503/);
  assert.doesNotMatch(r, /export async function (POST|PUT|PATCH|DELETE)/);
});
t("tipe database: fungsi simulasi hilang, counting_house_totals dan patronage_cutover ada", () => {
  const d = read("types/database.ts");
  assert.doesNotMatch(d, /\bstake_wage\b|\bunstake_wage\b/);
  assert.match(d, /counting_house_totals: \{/);
  assert.match(d, /patronage_cutover: \{/);
  assert.doesNotMatch(d, /distributed: number|treasuryRedirect|stakerCount/);
});

// ---- 5. audit kata terlarang (§10) -----------------------------------------------------------------------
t("audit kata terlarang: seluruh proyek bersih", () => {
  const { files, hits } = scanWording(".");
  assert.ok(files > 100, `terlalu sedikit file dipindai: ${files}`);
  assert.deepEqual(hits.map((h) => `${h.file}:${h.line} ${h.words}`), []);
});
t("audit kata terlarang: bisa gagal (bukti negatif)", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  writeFileSync(join(dir, "a.tsx"), "export const x = 'Earn 12% APY on your stake';\n");
  writeFileSync(join(dir, "b.md"), "bersih\nhigh yield pool\n");
  const { hits } = scanWording(dir);
  assert.deepEqual(hits.map((h) => `${h.file}:${h.line}`).sort(), ["a.tsx:1", "b.md:2"]);
});

// ---- 6. daftar periksa penerimaan, yang bisa dibuktikan dari kode (BUKAN pengganti teks §10) -----------------
// Teks §10 tidak ada di zip yang saya terima; daftar ini disusun dari ringkasan 4A-4D. Cocokkan dengan brief.
t("penerimaan (turunan): hook web3 + panel on-chain menggantikan panel simulasi", () => {
  const sec = read("components/patronage-section.tsx");
  assert.match(sec, /useNetworkGate/);
  assert.match(sec, /Switch to \$\{gate\.networkName\}/);
  assert.match(sec, /Approve & stake/);
  assert.doesNotMatch(sec, /(?<![A-Za-z])fetch\(|\/api\/agents/);
  assert.match(read("components/tx-status.tsx"), /explorerTx\(hash\)/);
});
t("penerimaan (turunan): /patronage punya caption historis, Claim all (claimMany), disclaimer, dan tautan nav", () => {
  const c = read("components/patronage/patronage-client.tsx");
  assert.match(c, /PATRONAGE_LABEL\.historical/);
  assert.match(c, /Not financial advice/);
  assert.match(c, /explorerAddress\(c\.address\)/);
  assert.match(read("lib/wording.ts"), /historical: "Past 7 days, not a forecast"/);
  assert.match(read("components/patronage/position-panel.tsx"), /actions\.claimMany\(batch\.ids\)/);
  assert.match(read("components/site-nav.tsx"), /href: "\/patronage"/);
});
t("penerimaan (turunan): kota dan Weighhouse membaca on-chain (cincin, stat bar, metrik, ledger)", () => {
  assert.match(read("components/realtime-city-dashboard.tsx"), /usePatronBuildings/);
  assert.match(read("lib/weighhouse/metrics.ts"), /rpc\('patronage_totals'\)/);
  assert.match(read("lib/weighhouse/events.ts"), /PATRONAGE_LEDGER_EVENT_NAMES: string\[\] = \["Staked", "RewardNotified", "RewardRedirected"\]/);
  assert.match(read("supabase/migrations/0019_weighhouse_patronage.sql"), /from building_pools bp/);
});

// ---- Kalimat ledger (brief §8.3) dan daftar kata terlarang (§8.4) ----
t("ledgerSentence: tiga kalimat sesuai brief §8.3", () => {
  const w = "0x1234567890abcdef1234567890abcdef12345678";
  assert.equal(
    ledgerSentence({ kind: "Staked", amountText: "5,000 WAGE", building: { name: "Deepdive" }, wallet: w }),
    "0x1234…5678 staked 5,000 WAGE on Deepdive",
  );
  assert.equal(
    ledgerSentence({ kind: "Patron reward", amountText: "240 WAGE", building: { name: "Deepdive" } }),
    "240 WAGE shared with Deepdive's patrons",
  );
  assert.equal(
    ledgerSentence({ kind: "Redirected", amountText: "60 WAGE", building: { name: "Gas Oracle" } }),
    "No patrons on Gas Oracle. 60 WAGE routed to the treasury",
  );
});
t("ledgerSentence: bangunan/wallet tak terpetakan diganti kata netral; jenis lain tanpa kalimat", () => {
  assert.equal(ledgerSentence({ kind: "Staked", amountText: "1 WAGE", building: null, wallet: null }), "A patron staked 1 WAGE on a building");
  assert.equal(ledgerSentence({ kind: "Patron reward", amountText: "1 WAGE", building: null }), "1 WAGE shared with the building's patrons");
  for (const kind of ["Sealed", "Burned", "Split", "Locked"]) {
    assert.equal(ledgerSentence({ kind, amountText: "1 WAGE", building: null }), null, kind);
  }
  assert.equal(shortWallet("bukan-alamat"), "bukan-alamat");
});
t("ledgerSentence: dipakai oleh ledger Weighhouse, dan wallet ikut dari args.user", () => {
  assert.match(read("components/weighhouse/weighhouse-client.tsx"), /ledgerSentence\(\{/);
  assert.match(read("lib/weighhouse/metrics.ts"), /\.args as Record<string, unknown> \| null\)\?\.user/);
  for (const k of ["Staked", "Patron reward", "Redirected"]) {
    const sentence = ledgerSentence({ kind: k, amountText: "1 WAGE", building: { name: "X" }, wallet: null }) ?? "";
    assert.deepEqual(findForbiddenWording(sentence), [], k);
  }
});
t("kata terlarang mengikuti brief §8.4: passive income dan guaranteed ikut terdeteksi", () => {
  assert.deepEqual(findForbiddenWording("Earn passive income"), ["passive income"]);
  assert.deepEqual(findForbiddenWording("Returns are guaranteed"), ["guaranteed"]);
  assert.deepEqual(findForbiddenWording("Nothing is promised. Charter guarantees hold."), []);
});
t("README: tanpa kata \"Upside\", dengan \"Nothing is promised\"", () => {
  const r = read("README.md");
  assert.doesNotMatch(r, /Share the Upside/);
  assert.match(r, /Nothing is promised/);
});

console.log(`\n${n} kelompok uji lulus`);
