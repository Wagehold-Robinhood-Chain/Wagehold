import { createServiceRoleClient } from "@/lib/supabase/server";
import { weighhouseClient as publicClient } from "./rpc";
import { ADDRESSES, OPEN_ITEMS, PONS } from "@/lib/web3/addresses";
import { ERC20_ABI } from "./events";
import { readPoolState, wagePoolKey } from "./pons";
import { fullRangeReserves } from "./v4math";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Snapshot supply (brief §4B/§5.3): satu putaran readContract paralel untuk semua balanceOf + totalSupply.
 *  Dipanggil cron; halaman hanya membaca supply_snapshots (tanpa RPC di jalur request). */
export async function takeSupplySnapshot() {
  const token = ADDRESSES.wageToken;

  // Satu putaran readContract paralel (bukan multicall): definisi chain Robinhood tidak memuat alamat
  // Multicall3, sehingga publicClient.multicall() gagal ("chain does not support multicall3").
  const read = (a?: `0x${string}`): Promise<bigint> =>
    a
      ? (publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [a] }) as Promise<bigint>)
      : (publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "totalSupply" }) as Promise<bigint>);

  const addrs = [
    undefined, // totalSupply
    ADDRESSES.furnace,
    ZERO,
    PONS.launchLocker,
    ADDRESSES.strongbox,
    ADDRESSES.splitter,
    ADDRESSES.lampOilTreasury,
    ADDRESSES.titheTreasury,
    PONS.poolManager, // hanya untuk penjaga estimasi LP (bukan bucket)
    ...(OPEN_ITEMS.wageCurve ? [OPEN_ITEMS.wageCurve] : []),
  ];

  const [block, res] = await Promise.all([
    publicClient.getBlockNumber(),
    Promise.all(addrs.map((a) => read(a))),
  ]);
  const r = res as bigint[];
  const [total, burnedDead, burnedZero, locker, strongbox, splitter, lamp, tithe, poolManagerWage] = r;
  const curve = OPEN_ITEMS.wageCurve ? r[9] : 0n;
  const burned = burnedDead + burnedZero;
  const treasuries = lamp + tithe;

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

  const circulating = total - burned - curve - locker - (lp ?? 0n) - strongbox - splitter - treasuries;

  const row = {
    taken_at: new Date().toISOString(),
    block_number: Number(block),
    total: total.toString(), burned: burned.toString(), curve: curve.toString(),
    lp: lp === null ? null : (lp as bigint).toString(),
    locker: locker.toString(), strongbox: strongbox.toString(), splitter: splitter.toString(),
    treasuries: treasuries.toString(), circulating: circulating.toString(),
  };
  const { error } = await createServiceRoleClient().from("supply_snapshots").insert(row as never);
  return error ? { ok: false as const, error: error.message } : { ok: true as const, row };
}
