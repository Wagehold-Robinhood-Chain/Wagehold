/**
 * Mengisi item terbuka brief §9 dari chain, bukan dari tebakan. Hasilnya berupa baris env siap-tempel.
 *   npx tsx --env-file=.env.local scripts/weighhouse-discover.ts [--from-block <n>]
 *
 * Yang ditemukan:
 *  1. WEIGHHOUSE_DEPLOY_BLOCK        blok pembuatan kontrak Strongbox/Splitter paling awal
 *  2. WEIGHHOUSE_WAGE_CURVE          dari event TokenLaunched(token) di factory Pons V2
 *  3. WEIGHHOUSE_PAIR_TOKEN          quote asset launch (ETH native = address(0))
 *  4. status graduation + pool ID    pool ID DIHITUNG lalu DIBUKTIKAN terhadap event Initialize
 *  5. NEXT_PUBLIC_WAGE_GRADUATED_AT  waktu event PoolGraduated
 *  6. cek layout storage PoolManager (tick harus konsisten dengan sqrtPriceX96)
 *
 * Perlu RPC dengan state historis (getCode pada blok lama) untuk menemukan blok pembuatan kontrak.
 * Kalau RPC Anda tidak menyimpannya, skrip menunjukkan cara mengisi manual dari Blockscout.
 */
import { createPublicClient, http, type Hex } from "viem";
import { activeChain } from "../lib/web3/chains";
import { ADDRESSES, OPEN_ITEMS, PONS, explorerAddress } from "../lib/web3/addresses";
import { POOL_GRADUATED_EVENT, TOKEN_LAUNCHED_EVENT, V4_INITIALIZE_EVENT, ERC20_ABI } from "../lib/weighhouse/events";
import { PONS_POOL_FEE, PONS_POOL_TICK_SPACING, ZERO_ADDRESS, readPoolState, wagePoolKey, type AnyClient } from "../lib/weighhouse/pons";
import { fullRangeReserves, quotePerWage } from "../lib/weighhouse/v4math";

const client = createPublicClient({ chain: activeChain, transport: http() }) as unknown as AnyClient;
const out: string[] = [];
const warn: string[] = [];
const say = (m: string) => console.log(m);

const argFrom = process.argv.indexOf("--from-block");
const manualFrom = argFrom > -1 ? BigInt(process.argv[argFrom + 1]) : undefined;

async function hasCode(a: `0x${string}`, block: bigint) {
  const c = await client.getCode({ address: a, blockNumber: block });
  return !!c && c !== "0x";
}

/** Blok pertama yang memuat kode kontrak (binary search). null = tidak bisa ditentukan. */
async function creationBlock(a: `0x${string}`): Promise<bigint | null> {
  try {
    const latest = await client.getBlockNumber();
    if (!(await hasCode(a, latest))) return null;
    let lo = 0n, hi = latest;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if (await hasCode(a, mid)) hi = mid; else lo = mid + 1n;
    }
    return lo;
  } catch (e) {
    say(`  (RPC tidak menyimpan state historis untuk ${a}: ${e instanceof Error ? e.message.split("\n")[0] : e})`);
    return null;
  }
}

/** getLogs seluruh rentang; kalau RPC menolak rentang besar, turun ke potongan. */
async function logsAcross<T>(run: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint): Promise<T[]> {
  try { return await run(from, to); } catch { /* rentang terlalu besar -> potong */ }
  const all: T[] = [];
  const step = 200_000n;
  for (let f = from; f <= to; f += step) {
    const t = f + step - 1n > to ? to : f + step - 1n;
    all.push(...(await run(f, t)));
    process.stdout.write(`\r  scan ${f}..${t} / ${to}`);
  }
  process.stdout.write("\n");
  return all;
}

async function main() {
  say(`Chain: ${activeChain.name} (${activeChain.id})\nToken: ${ADDRESSES.wageToken}\n`);

  // 1. deploy block --------------------------------------------------------------------------
  say("1) DEPLOY_BLOCK (Strongbox + Splitter)");
  const [sb, sp] = await Promise.all([creationBlock(ADDRESSES.strongbox), creationBlock(ADDRESSES.splitter)]);
  say(`   Strongbox dibuat di blok ${sb ?? "?"}, Splitter di blok ${sp ?? "?"}`);
  if (sb != null && sp != null) out.push(`WEIGHHOUSE_DEPLOY_BLOCK=${sb < sp ? sb : sp}`);
  else warn.push(
    `DEPLOY_BLOCK: isi manual dari "Contract creation" di Blockscout:\n     ${explorerAddress(ADDRESSES.strongbox)}\n     ${explorerAddress(ADDRESSES.splitter)}\n   (ambil blok yang lebih kecil)`,
  );

  // 2. TokenLaunched -> curve + pair token ---------------------------------------------------
  say("\n2) Bonding curve ($WAGE di Pons V2)");
  const tokenBlock = manualFrom ?? (await creationBlock(ADDRESSES.wageToken));
  let launchBlock: bigint | null = null;
  let pairToken: `0x${string}` = OPEN_ITEMS.pairToken ?? ZERO_ADDRESS;
  if (tokenBlock == null) {
    warn.push("Blok pembuatan token tidak ditemukan. Jalankan ulang dengan --from-block <blok launch $WAGE> (lihat Blockscout, tab Contract).");
  } else {
    const launches = await client.getLogs({
      address: PONS.launchFactory, event: TOKEN_LAUNCHED_EVENT, args: { token: ADDRESSES.wageToken },
      fromBlock: tokenBlock > 50n ? tokenBlock - 50n : 0n, toBlock: tokenBlock + 2000n,
    });
    if (launches.length === 0) {
      warn.push(
        `Tidak ada TokenLaunched untuk $WAGE dari factory ${PONS.launchFactory} dekat blok ${tokenBlock}. ` +
          "Token mungkin diluncurkan lewat factory lain (mis. Pons V1, yang tidak punya bonding curve) -- jangan isi WEIGHHOUSE_WAGE_CURVE.",
      );
    } else {
      const l = launches[0];
      launchBlock = l.blockNumber;
      const { curve, pairToken: pt, graduationThreshold } = l.args as unknown as { curve: `0x${string}`; pairToken: `0x${string}`; graduationThreshold: bigint };
      pairToken = pt.toLowerCase() as `0x${string}`;
      say(`   curve        ${curve}\n   pairToken    ${pairToken}${pairToken === ZERO_ADDRESS ? " (ETH native)" : ""}\n   threshold    ${graduationThreshold} (unit quote mentah)\n   launch tx    ${l.transactionHash} (blok ${launchBlock})`);
      out.push(`WEIGHHOUSE_WAGE_CURVE=${curve.toLowerCase()}`);
      if (pairToken !== ZERO_ADDRESS) out.push(`WEIGHHOUSE_PAIR_TOKEN=${pairToken}`);
      out.push(`# opsional: hitung trading sejak launch (backfill lebih lama):\n# WEIGHHOUSE_MARKET_START_BLOCK=${launchBlock}`);
    }
  }

  // 3. pool ID + graduation ------------------------------------------------------------------
  say("\n3) Graduation + pool Uniswap v4");
  // Pool ID dihitung dengan pair token yang DITEMUKAN di chain (bukan yang ada di env).
  const key = wagePoolKey(pairToken);
  const wageIsToken0 = key.wageIsToken0;
  if ((OPEN_ITEMS.pairToken ?? ZERO_ADDRESS) !== pairToken) {
    warn.push(`Env WEIGHHOUSE_PAIR_TOKEN (${OPEN_ITEMS.pairToken ?? "kosong = ETH native"}) berbeda dari quote asli launch ($pairToken). Pasang nilai dari bagian env di bawah.`.replace("$pairToken", pairToken));
  }
  say(`   PoolKey: fee=${PONS_POOL_FEE} tickSpacing=${PONS_POOL_TICK_SPACING} hooks=${PONS.memeHook}\n   pool ID (dihitung) ${key.poolId}`);

  let state: Awaited<ReturnType<typeof readPoolState>> = null;
  try {
    state = await readPoolState(client, key.poolId as Hex);
  } catch (e) {
    warn.push(e instanceof Error ? e.message : String(e));
  }

  if (state === null) {
    say("   Pool belum diinisialisasi -> $WAGE masih di bonding curve (belum graduation).");
  } else {
    say(`   GRADUATED. sqrtPriceX96=${state.sqrtPriceX96} tick=${state.tick} liquidity=${state.liquidity}`);
    say("   Layout storage PoolManager: OK (tick konsisten dengan sqrtPriceX96).");

    const latest = await client.getBlockNumber();
    const from = launchBlock ?? tokenBlock ?? 0n;
    const grads = await logsAcross(
      (f, t) => client.getLogs({ address: PONS.launchFactory, event: POOL_GRADUATED_EVENT, args: { token: ADDRESSES.wageToken }, fromBlock: f, toBlock: t }),
      from, latest,
    );
    if (grads[0]) {
      const g = grads[0];
      const blk = await client.getBlock({ blockNumber: g.blockNumber });
      const iso = new Date(Number(blk.timestamp) * 1000).toISOString();
      say(`   PoolGraduated di blok ${g.blockNumber} (${iso}), tx ${g.transactionHash}`);
      out.push(`NEXT_PUBLIC_WAGE_GRADUATED_AT=${iso}`);

      // Bukti pool ID: event Initialize dengan id yang sama harus ada di blok graduation.
      const inits = await client.getLogs({
        address: PONS.poolManager, event: V4_INITIALIZE_EVENT, args: { id: key.poolId as Hex },
        fromBlock: g.blockNumber > 5n ? g.blockNumber - 5n : 0n, toBlock: g.blockNumber + 5n,
      });
      if (inits.length) {
        const a = inits[0].args as unknown as { hooks: string; fee: number; tickSpacing: number };
        say(`   TERBUKTI: Initialize(id=${key.poolId}) ada di blok ${inits[0].blockNumber}; hooks=${a.hooks} fee=${a.fee} tickSpacing=${a.tickSpacing}`);
      } else {
        warn.push(
          `Pool ID hasil hitungan TIDAK ditemukan pada event Initialize di blok graduation. Pool ID itu hanya benar kalau PoolKey sesuai; ` +
            `cari Initialize di Blockscout (tx ${g.transactionHash}), lalu isi WEIGHHOUSE_V4_POOL_ID dengan nilai id-nya.`,
        );
      }
    } else {
      warn.push("Pool sudah ada tapi event PoolGraduated tidak ditemukan (RPC membatasi rentang?). Isi NEXT_PUBLIC_WAGE_GRADUATED_AT manual dari Blockscout.");
    }

    // 4. ringkasan pool (estimasi full-range) + penjaga -----------------------------------------
    const est = fullRangeReserves(state.liquidity, state.sqrtPriceX96, wageIsToken0);
    const pmWage = await client.readContract({ address: ADDRESSES.wageToken, abi: ERC20_ABI, functionName: "balanceOf", args: [PONS.poolManager] });
    say(`\n4) Cadangan pool (estimasi full-range)\n   WAGE  ${(Number(est.wage) / 1e18).toLocaleString()}  (saldo WAGE PoolManager: ${(Number(pmWage) / 1e18).toLocaleString()})`);
    if (est.wage > pmWage) warn.push("Estimasi WAGE di pool melebihi saldo PoolManager -> ada LP non-full-range; LP pool akan tampil 'Not tracked'.");
    const dec = pairToken === ZERO_ADDRESS ? 18 : Number(await client.readContract({ address: pairToken, abi: ERC20_ABI, functionName: "decimals" }));
    say(`   Harga spot: ${quotePerWage(state.sqrtPriceX96, wageIsToken0, dec)} ${pairToken === ZERO_ADDRESS ? "ETH" : "unit quote"} per WAGE`);
  }

  say("\n──────── tempel ke .env.local (dan Vercel) ────────");
  say(out.join("\n") || "(tidak ada nilai yang bisa ditemukan)");
  if (warn.length) {
    say("\n──────── PERLU PERHATIAN ────────");
    warn.forEach((w, i) => say(`${i + 1}. ${w}`));
    process.exitCode = 2;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
