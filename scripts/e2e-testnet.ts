/**
 * Fase 2 item 8 -- test end-to-end di testnet.
 *
 * Menjalankan seluruh siklus hidup wage terhadap kontrak yang SUDAH ter-deploy, lewat RPC
 * mana pun yang menunjuk ke chain id 46630 (Robinhood Chain testnet, atau Anvil lokal yang
 * dijalankan dengan `--chain-id 46630`). Bagian SERVER memakai kode aplikasi yang sama
 * persis dengan yang dipakai Route Handler (`lib/web3/verify-lock.ts`, `council.ts`,
 * `verify-release.ts`) -- bukan reimplementasi. Bagian WALLET CLIENT (approve token,
 * `createJob`, `approve`) meniru `lock-wage.ts` / `set-the-seal.ts` dengan viem +
 * private key, karena dua file itu memanggil wagmi/AppKit yang butuh browser + wallet.
 *
 * Pakai:
 *   npx tsx scripts/e2e-testnet.ts --mode splitter   # Strongbox + Splitter 60/20/10/10 (+ refund, dispute)
 *   npx tsx scripts/e2e-testnet.ts --mode direct     # tanpa Splitter, wage penuh ke wallet Wright
 *   opsional: --with-finding   jalankan skenario S5 (dispute parsial + Splitter). Sudah DIPERBAIKI di
 *                              kontrak (releasedToPayee); skenario ini memverifikasinya. Jangan jalankan
 *                              ke Splitter LAMA (sebelum perbaikan) -- itu mencemari Splitter-nya.
 *
 * Env: lihat scripts/.env.e2e.example. `.env.local` dibaca sebagai cadangan, jadi yang diuji
 * adalah konfigurasi yang sama dengan yang dipakai app.
 */
import { existsSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  http,
  isAddressEqual,
  parseAbi,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

// ---------------------------------------------------------------------------------------
// 0. Argumen + env (harus siap SEBELUM library app di-import: mereka membaca env saat load)
// ---------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const argMode = argv.includes("--mode") ? argv[argv.indexOf("--mode") + 1] : "splitter";
if (argMode !== "splitter" && argMode !== "direct") {
  console.error(`--mode harus "splitter" atau "direct" (dapat: ${argMode})`);
  process.exit(2);
}
const MODE: "splitter" | "direct" = argMode;
const WITH_FINDING = argv.includes("--with-finding");

for (const f of [
  path.resolve(process.cwd(), "scripts/.env.e2e"),
  path.resolve(process.cwd(), ".env.local"),
]) {
  if (existsSync(f)) process.loadEnvFile(f); // tidak menimpa env yang sudah ada
}
if (MODE === "direct") delete process.env.WAGEHOLD_SPLITTER_ADDRESS;

// ---------------------------------------------------------------------------------------
// ABI tambahan (ABI app sengaja minimal; E2E butuh fungsi + error lain untuk uji negatif)
// ---------------------------------------------------------------------------------------
const strongboxExtraAbi = parseAbi([
  "function refund(bytes32 jobId)",
  "function dispute(bytes32 jobId)",
  "function resolveDispute(bytes32 jobId, uint256 payeeAmount, uint256 refundAmount)",
  "function withdraw()",
  "function pendingWithdrawals(address) view returns (uint256)",
  "error ZeroAmount()",
  "error JobAlreadyExists()",
  "error PayeeAlreadySet()",
  "error SplitMismatch()",
  "error NothingToWithdraw()",
]);
const splitterExtraAbi = parseAbi([
  "function withdraw()",
  "function pendingWithdrawals(address) view returns (uint256)",
  "function lampOilTreasury() view returns (address)",
  "function pendingBurn() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function burn()",
  "function titheTreasury() view returns (address)",
  "function council() view returns (address)",
  "error NotCouncil()",
  "error NothingToWithdraw()",
  "error JobNotRegistered()",
  "error JobAlreadySplit()",
  "error JobNotReleasedYet()",
]);
const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);

// ---------------------------------------------------------------------------------------
// Pelaporan
// ---------------------------------------------------------------------------------------
type Row = {
  scenario: string;
  step: string;
  status: "pass" | "fail" | "finding" | "info";
  detail?: string;
  tx?: string;
  gasUsed?: string;
  ms?: number;
};
const rows: Row[] = [];
let currentScenario = "setup";
let explorer: string | undefined;

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };
function log(row: Row) {
  rows.push(row);
  const icon = { pass: `${C.g}✓${C.x}`, fail: `${C.r}✗${C.x}`, finding: `${C.y}⚠${C.x}`, info: `${C.d}·${C.x}` }[
    row.status
  ];
  const tx = row.tx ? ` ${C.d}${explorer ? `${explorer}/tx/${row.tx}` : row.tx}${C.x}` : "";
  const gas = row.gasUsed ? ` ${C.d}gas=${row.gasUsed}${C.x}` : "";
  console.log(`  ${icon} ${row.step}${row.detail ? ` — ${row.detail}` : ""}${gas}${tx}`);
}

class ScenarioAbort extends Error {}

function fail(step: string, detail: string): never {
  log({ scenario: currentScenario, step, status: "fail", detail });
  throw new ScenarioAbort(`${step}: ${detail}`);
}
function pass(step: string, extra: Partial<Row> = {}) {
  log({ scenario: currentScenario, step, status: "pass", ...extra });
}
function info(step: string, detail?: string) {
  log({ scenario: currentScenario, step, status: "info", detail });
}
function assertEq<T>(step: string, actual: T, expected: T, extra: Partial<Row> = {}) {
  if (actual !== expected) fail(step, `diharapkan ${String(expected)}, dapat ${String(actual)}`);
  pass(step, { detail: extra.detail ?? String(actual), ...extra });
}

function revertName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? "revert";
  }
  return undefined;
}

/** Lulus hanya kalau `run()` revert dengan custom error `errorName`. */
async function expectRevert(step: string, errorName: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    const got = revertName(e);
    if (got === errorName) return pass(step, { detail: `revert ${errorName}` });
    return fail(step, `harusnya revert ${errorName}, dapat ${got ?? (e as Error).message.split("\n")[0]}`);
  }
  return fail(step, `harusnya revert ${errorName}, tapi tidak revert`);
}

/** Lulus hanya kalau fungsi async (kode server app) melempar error yang cocok dengan `re`. */
async function expectThrows(step: string, re: RegExp, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    const msg = (e as Error).message;
    if (re.test(msg)) return pass(step, { detail: msg.split("\n")[0].slice(0, 110) });
    return fail(step, `error tak cocok ${re}: ${msg.split("\n")[0]}`);
  }
  return fail(step, `harusnya melempar error ${re}, tapi sukses`);
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Env ${name} belum diisi (lihat scripts/.env.e2e.example).`);
    process.exit(2);
  }
  return v;
}
function key(name: string): Hex {
  const v = requireEnv(name);
  return (v.startsWith("0x") ? v : `0x${v}`) as Hex;
}

async function main() {
  const rpc = process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com";
  const strongbox = requireEnv("NEXT_PUBLIC_STRONGBOX_ADDRESS") as Address;
  const token = requireEnv("NEXT_PUBLIC_WAGE_TOKEN_ADDRESS") as Address;
  const splitter = (MODE === "splitter" ? requireEnv("WAGEHOLD_SPLITTER_ADDRESS") : undefined) as
    | Address
    | undefined;
  const councilAccount = privateKeyToAccount(key("COUNCIL_PRIVATE_KEY"));
  const clientAccount = privateKeyToAccount(key("E2E_CLIENT_PRIVATE_KEY"));
  const wageUnits = process.env.E2E_WAGE_UNITS || "100";
  const gasTopup = parseEther(process.env.E2E_GAS_TOPUP_ETH || "0.0005");

  // Library app -- di-import SETELAH env siap.
  const { robinhoodTestnet } = await import("@/lib/web3/chains");
  const { strongboxAbi, splitterAbi, computeJobId, JobStatus } = await (async () => {
    const s = await import("@/lib/web3/strongbox");
    const sp = await import("@/lib/web3/splitter");
    return { strongboxAbi: s.strongboxAbi, splitterAbi: sp.splitterAbi, computeJobId: s.computeJobId, JobStatus: s.JobStatus };
  })();
  const { verifyOnChainLock } = await import("@/lib/web3/verify-lock");
  const { verifyReleased } = await import("@/lib/web3/verify-release");
  const { preparePayeeOnChain, splitAfterRelease } = await import("@/lib/web3/council");

  const SB = [...strongboxAbi, ...strongboxExtraAbi] as const;
  const SP = [...splitterAbi, ...splitterExtraAbi] as const;

  const pub = createPublicClient({ chain: robinhoodTestnet, transport: http(rpc) }) as PublicClient;
  const wallet = (account: PrivateKeyAccount) =>
    createWalletClient({ account, chain: robinhoodTestnet, transport: http(rpc) });
  const councilW = wallet(councilAccount);
  const clientW = wallet(clientAccount);

  // ------------------------------------------------------------------ helpers on-chain
  async function send(
    step: string,
    w: ReturnType<typeof wallet>,
    req: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }
  ) {
    const t0 = Date.now();
    // simulate dulu: revert tampil sebagai nama error, bukan "execution reverted" mentah
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { request } = await pub.simulateContract({ account: w.account, ...(req as any) });
    const hash = await w.writeContract(request);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") fail(step, `tx ${hash} revert`);
    pass(step, { tx: hash, gasUsed: receipt.gasUsed.toString(), ms: Date.now() - t0 });
    return receipt;
  }
  const bal = (a: Address) =>
    pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a] });
  const sbPending = (a: Address) =>
    pub.readContract({ address: strongbox, abi: SB, functionName: "pendingWithdrawals", args: [a] }) as Promise<bigint>;
  const spPending = (a: Address) =>
    pub.readContract({ address: splitter!, abi: SP, functionName: "pendingWithdrawals", args: [a] }) as Promise<bigint>;
  const getJob = (id: Hex) =>
    pub.readContract({ address: strongbox, abi: strongboxAbi, functionName: "getJob", args: [id] });

  /** Meniru `lockWageOnChain` (lib/web3/lock-wage.ts): approve kalau allowance kurang, lalu createJob. */
  async function lockWage(step: string, uuid: string, amount: bigint) {
    const jobId = computeJobId(uuid);
    const allowance = await pub.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [clientAccount.address, strongbox],
    });
    if (allowance < amount) {
      await send(`${step}: approve token`, clientW, { address: token, abi: erc20Abi, functionName: "approve", args: [strongbox, amount] });
    }
    await send(`${step}: createJob`, clientW, { address: strongbox, abi: SB, functionName: "createJob", args: [jobId, amount] });
    return jobId;
  }

  // ------------------------------------------------------------------ preflight
  console.log(`\nWagehold E2E — mode=${MODE}${WITH_FINDING ? " +finding" : ""}`);
  console.log(`RPC ${rpc}`);
  currentScenario = "preflight";
  console.log(`\n[preflight]`);

  const chainId = await pub.getChainId();
  if (chainId !== robinhoodTestnet.id) {
    fail("chain id", `RPC melapor ${chainId}, app mengunci ${robinhoodTestnet.id} (Anvil: jalankan dengan --chain-id ${robinhoodTestnet.id})`);
  }
  pass("chain id", { detail: String(chainId) });
  explorer = chainId === 46630 && !/127\.0\.0\.1|localhost/.test(rpc) ? "https://explorer.testnet.chain.robinhood.com" : undefined;

  for (const [label, a] of [["Strongbox", strongbox], ["wage token", token], ...(splitter ? ([["Splitter", splitter]] as const) : [])] as const) {
    const code = await pub.getCode({ address: a });
    if (!code || code === "0x") fail(`${label} ter-deploy`, `tidak ada bytecode di ${a}`);
    pass(`${label} ter-deploy`, { detail: a });
  }

  if (isAddressEqual(councilAccount.address, clientAccount.address)) {
    fail("client ≠ council", "E2E_CLIENT_PRIVATE_KEY tidak boleh sama dengan COUNCIL_PRIVATE_KEY (uji NotClient jadi tak bermakna)");
  }
  const onChainCouncil = (await pub.readContract({ address: strongbox, abi: strongboxAbi, functionName: "council" })) as Address;
  if (!isAddressEqual(onChainCouncil, councilAccount.address)) {
    fail("COUNCIL_PRIVATE_KEY = council() Strongbox", `${councilAccount.address} ≠ ${onChainCouncil}`);
  }
  pass("COUNCIL_PRIVATE_KEY = council() Strongbox", { detail: councilAccount.address });
  let lampOil: Address | undefined;
  let tithe: Address | undefined;
  if (splitter) {
    const spCouncil = (await pub.readContract({ address: splitter, abi: SP, functionName: "council" })) as Address;
    if (!isAddressEqual(spCouncil, councilAccount.address)) fail("council() Splitter", `${spCouncil} ≠ ${councilAccount.address}`);
    pass("council() Splitter cocok");
    lampOil = (await pub.readContract({ address: splitter, abi: SP, functionName: "lampOilTreasury" })) as Address;
    tithe = (await pub.readContract({ address: splitter, abi: SP, functionName: "titheTreasury" })) as Address;
    info("treasury", `lampOil=${lampOil} tithe=${tithe}`);
  }

  const decimals = await pub.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
  const amount = parseUnits(wageUnits, decimals);
  const fmt = (v: bigint) => `${formatUnits(v, decimals)}`;
  info("wage per job", `${wageUnits} (${amount} unit dasar, ${decimals} desimal)`);

  // ETH untuk gas
  for (const [label, a] of [["client", clientAccount.address], ["council", councilAccount.address]] as const) {
    const eth = await pub.getBalance({ address: a });
    if (eth < parseEther("0.0005")) fail(`ETH gas ${label}`, `saldo ${formatUnits(eth, 18)} ETH di ${a} terlalu sedikit -- isi dari faucet`);
    pass(`ETH gas ${label}`, { detail: `${formatUnits(eth, 18)} ETH` });
  }

  // Token untuk client: 4 job x wage cukup (S1/S3/S4 + cadangan)
  const need = amount * BigInt(4);
  let clientTokens = await bal(clientAccount.address);
  if (clientTokens < need) {
    try {
      await send("mint token ke client (MockUSDC)", councilW, { address: token, abi: mintAbi, functionName: "mint", args: [clientAccount.address, need] });
      clientTokens = await bal(clientAccount.address);
    } catch {
      fail("saldo token client", `client punya ${fmt(clientTokens)}, butuh ${fmt(need)}, dan token ini tidak bisa di-mint -- kirim token ke ${clientAccount.address}`);
    }
  }
  pass("saldo token client", { detail: fmt(clientTokens) });

  // Wright & pihak luar: akun sekali-pakai. Wright perlu ETH sedikit untuk menarik (withdraw).
  const wrightAccount = privateKeyToAccount(generatePrivateKey());
  // Bentuk yang dipakai preparePayeeOnChain sejak Patronage: { id (uuid agen), wallet }. `id` hanya dipakai pada build Patronage.
  const wrightAgent = { id: randomUUID(), wallet: wrightAccount.address };
  const wrightW = wallet(wrightAccount);
  const outsider = privateKeyToAccount(generatePrivateKey());
  {
    const t0 = Date.now();
    const hash = await clientW.sendTransaction({ to: wrightAccount.address, value: gasTopup });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") fail("danai Wright dengan ETH gas", "tx revert");
    pass("danai Wright (sekali-pakai) dengan ETH gas", { tx: hash, gasUsed: r.gasUsed.toString(), ms: Date.now() - t0, detail: wrightAccount.address });
  }

  // Yang kita pegang kuncinya: dipakai untuk menarik saldo tujuan split kalau alamatnya cocok.
  const holders = new Map<string, PrivateKeyAccount>();
  for (const a of [clientAccount, councilAccount, wrightAccount]) holders.set(a.address.toLowerCase(), a);
  for (const n of ["E2E_LAMP_OIL_PRIVATE_KEY", "E2E_TITHE_PRIVATE_KEY"]) {
    if (process.env[n]) {
      const a = privateKeyToAccount(key(n));
      holders.set(a.address.toLowerCase(), a);
    }
  }

  // Baseline saldo token Strongbox -- diambil ulang di awal TIAP skenario (lihat scenario()),
  // supaya sisa dari skenario/run sebelumnya tidak mengacaukan pengecekan "delta 0".
  let sbBalance0 = await bal(strongbox);

  // =====================================================================================
  // Skenario
  // =====================================================================================
  async function scenario(name: string, fn: () => Promise<void>) {
    currentScenario = name;
    console.log(`\n[${name}]`);
    sbBalance0 = await bal(strongbox);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof ScenarioAbort)) {
        log({ scenario: name, step: "error tak terduga", status: "fail", detail: (e as Error).message.split("\n")[0] });
      }
      console.log(`  ${C.r}skenario dihentikan${C.x}`);
    }
  }

  // ---- S1: siklus penuh dengan Splitter (60/20/10/10)
  async function S1() {
    const uuid = randomUUID();
    const jobId = computeJobId(uuid);
    const c0 = await bal(clientAccount.address);

    await lockWage("kunci wage", uuid, amount);
    assertEq("saldo Strongbox +wage", (await bal(strongbox)) - sbBalance0, amount, { detail: fmt(amount) });
    assertEq("saldo client −wage", c0 - (await bal(clientAccount.address)), amount, { detail: fmt(amount) });
    const j = await getJob(jobId);
    assertEq("getJob: status Open, client benar", j.status === JobStatus.Open && isAddressEqual(j.client, clientAccount.address), true);

    // kode server app (POST /api/jobs)
    const v = await verifyOnChainLock(uuid);
    assertEq("verifyOnChainLock membaca wage dari chain", v.budgetUsdc, Number(wageUnits), { detail: String(v.budgetUsdc) });
    await expectThrows("verifyOnChainLock menolak job yang tak pernah dikunci", /not Open on-chain/, () => verifyOnChainLock(randomUUID()));
    await expectThrows("verifyReleased menolak job yang masih Open", /not Released on-chain/, () => verifyReleased(uuid));

    // uji negatif kontrak sebelum payee ada
    await expectRevert("client approve sebelum payee → PayeeNotSet", "PayeeNotSet", () =>
      pub.simulateContract({ account: clientAccount, address: strongbox, abi: SB, functionName: "approve", args: [jobId] }));
    await expectRevert("client setPayee → NotCouncil", "NotCouncil", () =>
      pub.simulateContract({ account: clientAccount, address: strongbox, abi: SB, functionName: "setPayee", args: [jobId, wrightAccount.address] }));
    await expectRevert("pihak luar setPayee → NotCouncil", "NotCouncil", () =>
      pub.simulateContract({ account: outsider, address: strongbox, abi: SB, functionName: "setPayee", args: [jobId, outsider.address] }));

    // kode server app (POST /api/jobs/:id/seal/prepare)
    const prep = await preparePayeeOnChain(uuid, wrightAgent);
    assertEq("preparePayeeOnChain → ready", prep.state, "ready");
    const jp = await getJob(jobId);
    assertEq("payee on-chain = Splitter", isAddressEqual(jp.payee, splitter!), true, { detail: jp.payee });
    const sp = (await pub.readContract({ address: splitter!, abi: splitterAbi, functionName: "getSplit", args: [jobId] })) as { patronPool: Address; amount: bigint; split: boolean };
    assertEq("Splitter.registerJob: amount & Patron pool benar", sp.amount === amount && isAddressEqual(sp.patronPool, wrightAccount.address) && !sp.split, true);

    const nonce0 = await pub.getTransactionCount({ address: councilAccount.address });
    const prep2 = await preparePayeeOnChain(uuid, wrightAgent);
    assertEq("preparePayeeOnChain idempoten (tak kirim tx baru)", prep2.state === "ready" && (await pub.getTransactionCount({ address: councilAccount.address })) === nonce0, true);

    // hanya client yang boleh menyegel
    await expectRevert("council approve → NotClient (Charter I)", "NotClient", () =>
      pub.simulateContract({ account: councilAccount, address: strongbox, abi: SB, functionName: "approve", args: [jobId] }));
    await expectRevert("pihak luar approve → NotClient", "NotClient", () =>
      pub.simulateContract({ account: outsider, address: strongbox, abi: SB, functionName: "approve", args: [jobId] }));
    await expectRevert("client refund setelah payee terpasang → PayeeAlreadySet", "PayeeAlreadySet", () =>
      pub.simulateContract({ account: clientAccount, address: strongbox, abi: SB, functionName: "refund", args: [jobId] }));
    await expectRevert("pullAndSplit sebelum seal → JobNotReleasedYet", "JobNotReleasedYet", () =>
      pub.simulateContract({ account: outsider, address: splitter!, abi: SP, functionName: "pullAndSplit", args: [jobId] }));

    // snapshot ledger Splitter sebelum split
    const dests: Array<[string, Address, bigint]> = [
      ["Patron pool (Wright)", wrightAccount.address, (amount * BigInt(60)) / BigInt(100)],
      ["Lamp Oil", lampOil!, (amount * BigInt(20)) / BigInt(100)],
      ["Tithe", tithe!, amount - (amount * BigInt(60)) / BigInt(100) - (amount * BigInt(20)) / BigInt(100) - (amount * BigInt(10)) / BigInt(100)],
    ];
    const furnace = (amount * BigInt(10)) / BigInt(100);
    const burnedBefore = (await pub.readContract({ address: splitter!, abi: SP, functionName: "totalBurned" })) as bigint;
    const uniq = [...new Set(dests.map(([, a]) => a.toLowerCase()))] as Address[];
    const before = new Map(await Promise.all(uniq.map(async (a) => [a, await spPending(a)] as const)));
    const spTokenBefore = await bal(splitter!);

    // "Set the seal" oleh wallet client (meniru sealOnChain di lib/web3/set-the-seal.ts)
    await send("client Set the seal → approve()", clientW, { address: strongbox, abi: SB, functionName: "approve", args: [jobId] });
    const jr = await getJob(jobId);
    assertEq("status on-chain = Released", jr.status, JobStatus.Released);
    assertEq("Strongbox mengkredit Splitter sebesar wage", await sbPending(splitter!), amount, { detail: fmt(amount) });

    const rel = await verifyReleased(uuid);
    assertEq("verifyReleased lulus, payee = Splitter", isAddressEqual(rel.payee, splitter!), true);
    assertEq("preparePayeeOnChain setelah seal → already_released", (await preparePayeeOnChain(uuid, wrightAgent)).state, "already_released");

    // pullAndSplit (kode server app)
    const split = await splitAfterRelease(uuid);
    if (split.status !== "split") fail("splitAfterRelease", `status ${split.status}: ${"reason" in split ? split.reason : ""}`);
    pass("splitAfterRelease → pullAndSplit", { tx: split.txHash });

    const expected = new Map<string, bigint>();
    for (const [, a, v2] of dests) expected.set(a.toLowerCase(), (expected.get(a.toLowerCase()) ?? BigInt(0)) + v2);
    for (const [label, a, v2] of dests) {
      const delta = (await spPending(a)) - before.get(a.toLowerCase() as Address)!;
      const want = expected.get(a.toLowerCase())!;
      // kalau beberapa tujuan berbagi alamat (testnet default: semua = deployer), bandingkan total gabungan
      assertEq(`ledger Splitter: ${label}`, delta, want, { detail: `+${fmt(delta)}${want !== v2 ? ` (alamat dipakai bersama, total ${fmt(want)})` : ""}` });
    }
    const sum = dests.reduce((s, d) => s + d[2], BigInt(0));
    const burnedAfter = (await pub.readContract({ address: splitter!, abi: SP, functionName: "totalBurned" })) as bigint;
    const stillPending = (await pub.readContract({ address: splitter!, abi: SP, functionName: "pendingBurn" })) as bigint;
    assertEq("Furnace dibakar otomatis 10% (totalBurned naik)", burnedAfter - burnedBefore, furnace, { detail: fmt(furnace) });
    assertEq("pendingBurn kosong (burn otomatis lolos)", stillPending, BigInt(0));
    assertEq("60+20+10+10 = wage (tanpa dust hilang)", sum + furnace, amount);
    assertEq("Strongbox kosong untuk job ini (token keluar penuh)", (await bal(strongbox)) - sbBalance0, BigInt(0), { detail: "delta 0" });
    assertEq("token pindah ke Splitter sebesar wage dikurangi Furnace yang dibakar", (await bal(splitter!)) - spTokenBefore, amount - furnace, { detail: fmt(amount - furnace) });

    const again = await splitAfterRelease(uuid);
    assertEq("splitAfterRelease kedua → skipped", again.status, "skipped", { detail: "reason" in again ? again.reason : "" });
    await expectRevert("pullAndSplit ulang → JobAlreadySplit", "JobAlreadySplit", () =>
      pub.simulateContract({ account: outsider, address: splitter!, abi: SP, functionName: "pullAndSplit", args: [jobId] }));

    // tiap tujuan menarik sendiri (kalau kuncinya kita pegang)
    for (const a of uniq) {
      const holder = holders.get(a.toLowerCase());
      const want = expected.get(a.toLowerCase())!;
      if (!holder) {
        info(`withdraw ${a}`, `kunci tidak dipegang script -- ledger terbukti (+${fmt(want)}), penarikan dilewati`);
        continue;
      }
      const pending = await spPending(a);
      const tok0 = await bal(a);
      await send(`withdraw Splitter oleh ${a.slice(0, 8)}…`, wallet(holder), { address: splitter!, abi: SP, functionName: "withdraw" });
      assertEq("  saldo token naik sebesar pending", (await bal(a)) - tok0, pending, { detail: `+${fmt(pending)}` });
    }
    if (holders.has(wrightAccount.address.toLowerCase())) {
      await expectRevert("withdraw kedua Patron pool → NothingToWithdraw", "NothingToWithdraw", () =>
        pub.simulateContract({ account: wrightAccount, address: splitter!, abi: SP, functionName: "withdraw" }));
    }
  }

  // ---- S2: mode direct (tanpa Splitter): wage penuh ke wallet Wright
  async function S2() {
    const uuid = randomUUID();
    const jobId = computeJobId(uuid);
    await lockWage("kunci wage", uuid, amount);

    await expectThrows("preparePayeeOnChain tanpa wallet Wright & tanpa Splitter → ditolak", /no wallet address and no Splitter/, () => preparePayeeOnChain(uuid, { id: wrightAgent.id, wallet: null }));
    assertEq("preparePayeeOnChain → ready", (await preparePayeeOnChain(uuid, wrightAgent)).state, "ready");
    assertEq("payee on-chain = wallet Wright", isAddressEqual((await getJob(jobId)).payee, wrightAccount.address), true);

    await send("client Set the seal → approve()", clientW, { address: strongbox, abi: SB, functionName: "approve", args: [jobId] });
    const rel = await verifyReleased(uuid);
    assertEq("verifyReleased lulus, payee = Wright", isAddressEqual(rel.payee, wrightAccount.address), true);
    const sp = await splitAfterRelease(uuid);
    assertEq("splitAfterRelease → skipped (tanpa Splitter)", sp.status, "skipped", { detail: "reason" in sp ? sp.reason : "" });

    assertEq("Strongbox mengkredit Wright sebesar wage penuh", await sbPending(wrightAccount.address), amount, { detail: fmt(amount) });
    const t0 = await bal(wrightAccount.address);
    await send("Wright withdraw dari Strongbox", wrightW, { address: strongbox, abi: SB, functionName: "withdraw" });
    assertEq("saldo token Wright +wage penuh", (await bal(wrightAccount.address)) - t0, amount, { detail: fmt(amount) });
    assertEq("Strongbox kosong untuk job ini", (await bal(strongbox)) - sbBalance0, BigInt(0), { detail: "delta 0" });
  }

  // ---- S3: refund sebelum ada payee + uji guard createJob
  async function S3() {
    const uuid = randomUUID();
    const jobId = computeJobId(uuid);
    const p0 = await sbPending(clientAccount.address); // sisa kredit lama (mis. dari S5), kalau ada
    await lockWage("kunci wage", uuid, amount);

    await expectRevert("createJob dengan jobId yang sama → JobAlreadyExists", "JobAlreadyExists", () =>
      pub.simulateContract({ account: clientAccount, address: strongbox, abi: SB, functionName: "createJob", args: [jobId, amount] }));
    await expectRevert("createJob amount 0 → ZeroAmount", "ZeroAmount", () =>
      pub.simulateContract({ account: clientAccount, address: strongbox, abi: SB, functionName: "createJob", args: [computeJobId(randomUUID()), BigInt(0)] }));
    await expectRevert("council refund → NotClient", "NotClient", () =>
      pub.simulateContract({ account: councilAccount, address: strongbox, abi: SB, functionName: "refund", args: [jobId] }));

    await send("client refund()", clientW, { address: strongbox, abi: SB, functionName: "refund", args: [jobId] });
    assertEq("status on-chain = Refunded", (await getJob(jobId)).status, JobStatus.Refunded);
    await expectThrows("verifyOnChainLock menolak job Refunded", /not Open on-chain/, () => verifyOnChainLock(uuid));
    await expectRevert("refund kedua → InvalidStatus", "InvalidStatus", () =>
      pub.simulateContract({ account: clientAccount, address: strongbox, abi: SB, functionName: "refund", args: [jobId] }));
    await expectRevert("setPayee pada job Refunded → InvalidStatus", "InvalidStatus", () =>
      pub.simulateContract({ account: councilAccount, address: strongbox, abi: SB, functionName: "setPayee", args: [jobId, wrightAccount.address] }));

    const p1 = await sbPending(clientAccount.address);
    assertEq("Strongbox mengkredit client sebesar wage", p1 - p0, amount, { detail: fmt(amount) });
    const c0 = await bal(clientAccount.address);
    await send("client withdraw", clientW, { address: strongbox, abi: SB, functionName: "withdraw" });
    assertEq("saldo token client naik sebesar seluruh kredit (termasuk refund ini)", (await bal(clientAccount.address)) - c0, p1, { detail: `+${fmt(p1)}` });
  }

  // ---- S4: dispute ("Break the seal") + resolveDispute, payee = wallet Wright langsung
  async function S4() {
    const uuid = randomUUID();
    const jobId = computeJobId(uuid);
    await lockWage("kunci wage", uuid, amount);
    await send("council setPayee(Wright)", councilW, { address: strongbox, abi: SB, functionName: "setPayee", args: [jobId, wrightAccount.address] });

    await expectRevert("council dispute → NotClient", "NotClient", () =>
      pub.simulateContract({ account: councilAccount, address: strongbox, abi: SB, functionName: "dispute", args: [jobId] }));
    await send("client dispute() (Break the seal)", clientW, { address: strongbox, abi: SB, functionName: "dispute", args: [jobId] });
    assertEq("status on-chain = Disputed", (await getJob(jobId)).status, JobStatus.Disputed);

    await expectRevert("approve pada job Disputed → InvalidStatus", "InvalidStatus", () =>
      pub.simulateContract({ account: clientAccount, address: strongbox, abi: SB, functionName: "approve", args: [jobId] }));
    await expectThrows("verifyReleased menolak job Disputed", /not Released on-chain/, () => verifyReleased(uuid));

    const toPayee = (amount * BigInt(60)) / BigInt(100);
    const toClient = amount - toPayee;
    await expectRevert("resolveDispute jumlah tak pas → SplitMismatch", "SplitMismatch", () =>
      pub.simulateContract({ account: councilAccount, address: strongbox, abi: SB, functionName: "resolveDispute", args: [jobId, toPayee, toClient + BigInt(1)] }));
    await expectRevert("client resolveDispute → NotCouncil", "NotCouncil", () =>
      pub.simulateContract({ account: clientAccount, address: strongbox, abi: SB, functionName: "resolveDispute", args: [jobId, toPayee, toClient] }));

    const w0 = await bal(wrightAccount.address);
    const cp0 = await sbPending(clientAccount.address);
    const c0 = await bal(clientAccount.address);
    await send("council resolveDispute(60% Wright / 40% client)", councilW, { address: strongbox, abi: SB, functionName: "resolveDispute", args: [jobId, toPayee, toClient] });
    assertEq("status on-chain = Released", (await getJob(jobId)).status, JobStatus.Released);
    assertEq("Strongbox mengkredit client 40% (refund)", (await sbPending(clientAccount.address)) - cp0, toClient, { detail: fmt(toClient) });
    const cp1 = await sbPending(clientAccount.address);
    await send("Wright withdraw", wrightW, { address: strongbox, abi: SB, functionName: "withdraw" });
    await send("client withdraw", clientW, { address: strongbox, abi: SB, functionName: "withdraw" });
    assertEq("Wright menerima 60%", (await bal(wrightAccount.address)) - w0, toPayee, { detail: fmt(toPayee) });
    assertEq("client menerima 40% (refund)", (await bal(clientAccount.address)) - c0, cp1, { detail: `+${fmt(cp1)}` });
    assertEq("Strongbox kosong untuk job ini", (await bal(strongbox)) - sbBalance0, BigInt(0), { detail: "delta 0" });
  }

  // ---- S5 (opt-in): dispute + payee = Splitter, pembagian parsial. Menguji solvabilitas Splitter.
  async function S5() {
    const uuid = randomUUID();
    const jobId = computeJobId(uuid);
    await lockWage("kunci wage", uuid, amount);
    await preparePayeeOnChain(uuid, wrightAgent);
    await send("client dispute()", clientW, { address: strongbox, abi: SB, functionName: "dispute", args: [jobId] });

    const toPayee = (amount * BigInt(60)) / BigInt(100);
    const toClient = amount - toPayee;
    await send("council resolveDispute(60% Splitter / 40% client)", councilW, { address: strongbox, abi: SB, functionName: "resolveDispute", args: [jobId, toPayee, toClient] });
    assertEq("Strongbox mengkredit Splitter hanya bagian payee", await sbPending(splitter!), toPayee, { detail: fmt(toPayee) });

    const ledger = [wrightAccount.address, lampOil!, tithe!];
    const uniq = [...new Set(ledger.map((a) => a.toLowerCase()))] as Address[];
    const before = (await Promise.all(uniq.map((a) => spPending(a)))).reduce((s, v) => s + v, BigInt(0));
    const tok0 = await bal(splitter!);
    const s = await splitAfterRelease(uuid);
    info("splitAfterRelease", s.status === "split" ? "pullAndSplit sukses (tidak revert)" : `${s.status}`);
    const credited = (await Promise.all(uniq.map((a) => spPending(a)))).reduce((sm, v) => sm + v, BigInt(0)) - before;
    const backed = (await bal(splitter!)) - tok0;
    info("dikreditkan ke ledger Splitter", fmt(credited));
    info("token yang benar-benar masuk ke Splitter", fmt(backed));
    if (credited > backed) {
      log({
        scenario: currentScenario,
        step: "TEMUAN: Splitter mengkredit lebih besar dari yang diterimanya",
        status: "finding",
        detail: `kredit ${fmt(credited)} vs saldo masuk ${fmt(backed)} → kekurangan ${fmt(credited - backed)}`,
      });
      // (Hanya terjadi di Splitter LAMA.) Dampak: coba tarik jatah Patron dari saldo Splitter.
      const patronPending = await spPending(wrightAccount.address);
      const spTok = await bal(splitter!);
      try {
        await pub.simulateContract({ account: wrightAccount, address: splitter!, abi: SP, functionName: "withdraw" });
        info("dampak: withdraw Patron", `lolos (pending ${fmt(patronPending)}, saldo Splitter ${fmt(spTok)})`);
      } catch (e) {
        log({
          scenario: currentScenario,
          step: "DAMPAK: withdraw Patron gagal",
          status: "finding",
          detail: `pending ${fmt(patronPending)} > saldo token Splitter ${fmt(spTok)} → ${(e as Error).message.split("\n")[0].slice(0, 90)}`,
        });
      }
    } else {
      pass("Splitter solvent setelah dispute parsial (S5 diperbaiki)", { detail: `kredit ${fmt(credited)} = masuk ${fmt(backed)} (setelah Furnace dibakar)` });
    }
    // bersihkan: client menarik refund 40%-nya supaya tidak menggantung ke skenario/run berikutnya
    await send("client withdraw (bersih-bersih refund S5)", clientW, { address: strongbox, abi: SB, functionName: "withdraw" });
  }

  if (MODE === "splitter") {
    await scenario("S1  siklus penuh + Splitter 60/20/10/10", S1);
    await scenario("S3  refund sebelum ada payee", S3);
    await scenario("S4  dispute + resolveDispute", S4);
    if (WITH_FINDING) await scenario("S5  dispute parsial + Splitter (opt-in)", S5);
  } else {
    await scenario("S2  siklus penuh tanpa Splitter (direct)", S2);
    await scenario("S3  refund sebelum ada payee", S3);
    await scenario("S4  dispute + resolveDispute", S4);
  }

  // ------------------------------------------------------------------ ringkasan
  const n = (s: Row["status"]) => rows.filter((r) => r.status === s).length;
  const report = {
    generatedAt: new Date().toISOString(),
    mode: MODE,
    rpc: rpc.replace(/\/v2\/[^/]+$/, "/v2/***"),
    chainId,
    contracts: { strongbox, token, splitter: splitter ?? null },
    totals: { pass: n("pass"), fail: n("fail"), finding: n("finding") },
    rows,
  };
  const out = path.resolve(process.cwd(), `scripts/e2e-report-${MODE}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n${"─".repeat(60)}`);
  console.log(`mode=${MODE}  ✓ ${n("pass")}   ✗ ${n("fail")}   ⚠ temuan ${n("finding")}`);
  console.log(`laporan: ${path.relative(process.cwd(), out)}`);
  process.exit(n("fail") > 0 ? 1 : 0);
}

main().catch((e) => {
  if (e instanceof ScenarioAbort) {
    console.error(`\nPreflight gagal: ${e.message}`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
