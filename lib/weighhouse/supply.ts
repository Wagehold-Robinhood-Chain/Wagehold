import { createServiceRoleClient } from "@/lib/supabase/server";
import { weighhouseClient as publicClient } from "./rpc";
import { ADDRESSES, OPEN_ITEMS, PATRONAGE, PONS } from "@/lib/web3/addresses";
import { ERC20_ABI } from "./events";
import { readPoolState, wagePoolKey } from "./pons";
import { circulatingSupply } from "./supply-math";
import { fullRangeReserves } from "./v4math";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Snapshot supply (brief §4B/§5.3): satu putaran readContract paralel untuk semua balanceOf + totalSupply.
 *  Dipanggil cron; halaman hanya membaca supply_snapshots (tanpa RPC di jalur request). */
export async function takeSupplySnapshot() {
  // Token yang dipakai stack ini: NEXT_PUBLIC_WAGE_TOKEN_ADDRESS bila diisi (stack testnet 46630 punya token sendiri,
  // sama dengan yang dibaca Patronage lewat wageToken()), kalau tidak CA di brief. Semua bucket dibaca dari token yang sama.
  const envToken = process.env.NEXT_PUBLIC_WAGE_TOKEN_ADDRESS?.trim().toLowerCase();
  const token = (/^0x[0-9a-f]{40}$/.test(envToken ?? "") ? envToken : ADDRESSES.wageToken) as `0x${string}`;
  if (token !== ADDRESSES.wageToken) {
    console.warn(`[weighhouse] snapshot supply memakai token dari env (${token}), bukan CA brief (${ADDRESSES.wageToken}).`);
  }

  // Satu putaran readContract paralel (bukan multicall): definisi chain Robinhood tidak memuat alamat
  // Multicall3, sehingga publicClient.multicall() gagal ("chain does not support multicall3").
  const supplyOf = () =>
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "totalSupply" }) as Promise<bigint>;
  // Alamat opsional (kontrak v2 / Patronage belum tentu terisi di env): tanpa alamat = saldo 0, BUKAN totalSupply.
  const balanceOf = (a?: `0x${string}`): Promise<bigint> =>
    a
      ? (publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [a] }) as Promise<bigint>)
      : Promise.resolve(0n);

  const [
    block, total, burnedDead, burnedZero, locker, strongboxV1, splitterV1, lamp, tithe, poolManagerWage, curve,
    strongboxV2, splitterV2, patronage,
  ] = await Promise.all([
    publicClient.getBlockNumber(),
    supplyOf(),
    balanceOf(ADDRESSES.furnace),
    balanceOf(ZERO),
    balanceOf(PONS.launchLocker),
    balanceOf(ADDRESSES.strongbox),
    balanceOf(ADDRESSES.splitter),
    balanceOf(ADDRESSES.lampOilTreasury),
    balanceOf(ADDRESSES.titheTreasury),
    balanceOf(PONS.poolManager), // hanya untuk penjaga estimasi LP (bukan bucket)
    balanceOf(OPEN_ITEMS.wageCurve),
    // Patronage build (Tahap 4C). Strongbox/Splitter v2 digabung ke bucket Strongbox/Splitter yang sama;
    // saldo kontrak Patronage (stake + cooldown + reward belum diklaim) jadi bucket sendiri, kalau tidak
    // $WAGE yang di-stake ikut terhitung "Circulating".
    balanceOf(PATRONAGE.strongboxV2),
    balanceOf(PATRONAGE.splitterV2),
    balanceOf(PATRONAGE.patronage),
  ]);
  const burned = burnedDead + burnedZero;
  const treasuries = lamp + tithe;
  const strongbox = strongboxV1 + strongboxV2;
  const splitter = splitterV1 + splitterV2;

  // LP pasca-graduation: TIDAK dari saldo PoolManager mentah (isinya banyak token -- brief §4B).
  // Dibaca dari state pool $WAGE (pool ID dihitung dari token + hook Pons, lihat pons.ts) dengan model
  // posisi full-range (sesuai desain Pons: posisi graduation full-range yang dikunci). Hasil:
  //   - pool belum ada (pra-graduation)  -> 0n (benar, bukan "tidak tahu")
  //   - pool ada, estimasi masuk akal    -> estimasi WAGE di pool
  //   - gagal baca / estimasi > saldo WAGE PoolManager (ada LP non-full-range) -> null ("Not tracked")
  let lp: bigint | null = null;
  try {
    const state = await readPoolState(publicClient, wagePoolKey().poolId);
    if (state === null) {
      lp = 0n;
    } else {
      const est = fullRangeReserves(state.liquidity, state.sqrtPriceX96, wagePoolKey().wageIsToken0).wage;
      lp = est <= poolManagerWage ? est : null;
    }
  } catch (e) {
    console.warn("[weighhouse] LP pool tidak terbaca:", e instanceof Error ? e.message : e);
  }

  const circulating = circulatingSupply({ total, burned, curve, lp, locker, strongbox, splitter, treasuries, patronage });

  const row = {
    taken_at: new Date().toISOString(),
    block_number: Number(block),
    total: total.toString(), burned: burned.toString(), curve: curve.toString(),
    lp: lp === null ? null : (lp as bigint).toString(),
    locker: locker.toString(), strongbox: strongbox.toString(), splitter: splitter.toString(),
    treasuries: treasuries.toString(), patronage: patronage.toString(), circulating: circulating.toString(),
  };
  const { error } = await createServiceRoleClient().from("supply_snapshots").insert(row as never);
  return error ? { ok: false as const, error: error.message } : { ok: true as const, row };
}
