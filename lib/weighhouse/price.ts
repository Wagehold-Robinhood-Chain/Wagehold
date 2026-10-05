import { createServiceRoleClient } from "@/lib/supabase/server";
import { publicClient } from "@/lib/web3/public-client";
import { ADDRESSES } from "@/lib/web3/addresses";
import { ZERO_ADDRESS, quoteDecimals, readPoolState, readQuoteReserve, wagePoolKey } from "./pons";
import { quotePerWage } from "./v4math";

/**
 * Snapshot harga (brief §5.2), dipanggil cron tiap 5 menit.
 *
 * Sumber utama: Bitquery, cube `Trading` -- satu query yang sama untuk harga pra-graduation (curve,
 * protocol "pons_v2") dan pasca-graduation (pool v4), karena cube ini menyatukan keduanya per token
 * (docs.bitquery.io/docs/blockchain/robinhood/pons-api, bagian "Latest trades for a graduated token").
 * Fallback: on-chain (slot0 pool v4) -- hanya tersedia SETELAH graduation; pra-graduation tidak ada
 * fallback karena rumus curve tidak dipublikasikan, jadi snapshot dilewati (bukan angka karangan).
 *
 * `volume_wage` sengaja null: penyebut Work Ratio kini dihitung dari event on-chain (migrasi 0015),
 * sehingga tidak ada risiko hitung ganda dengan Bitquery.
 */
export type PriceSnap = {
  price_usd: number | null; price_eth: number | null; liquidity_usd: number | null;
  volume_wage: string | null; source: "bitquery" | "on-chain";
};

const BITQUERY_URL = "https://streaming.bitquery.io/graphql";
const ETH_SYMBOLS = new Set(["ETH", "WETH"]);

interface BitqueryTrade {
  priceUsd: number; priceQuote: number; quoteSymbol: string | null;
  /** USD per 1 unit quote, diturunkan dari trade itu sendiri (PriceInUsd / Price) -- tanpa feed eksternal. */
  quoteUsd: number;
}

/** Trade terakhir token ini di Robinhood (curve ATAU pool v4). Query = contoh resmi dokumentasi, dibatasi 1 baris. */
async function fetchFromBitquery(): Promise<BitqueryTrade | null> {
  const key = process.env.BITQUERY_API_KEY;
  if (!key) return null;
  const token = ADDRESSES.wageToken; // konstanta berformat hex tervalidasi -> aman disisipkan inline

  const query = `{
    Trading {
      Trades(
        limit: {count: 1}
        orderBy: {descending: Block_Time}
        where: { Pair: { Token: {Address: {is: "${token}"}} Market: {Network: {is: "Robinhood"}} } }
      ) {
        Block { Time }
        Price
        PriceInUsd
        Pair { QuoteToken { Symbol Address } Market { Protocol } }
      }
    }
  }`;

  const res = await fetch(BITQUERY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bitquery HTTP ${res.status}`);
  const json = (await res.json()) as {
    errors?: { message: string }[];
    data?: { Trading?: { Trades?: { Price: number | string; PriceInUsd: number | string; Pair?: { QuoteToken?: { Symbol?: string | null } } }[] } };
  };
  if (json.errors?.length) throw new Error(`Bitquery: ${json.errors[0].message}`);

  const t = json.data?.Trading?.Trades?.[0];
  if (!t) return null; // belum ada trade yang terindeks
  const priceUsd = Number(t.PriceInUsd), priceQuote = Number(t.Price);
  if (!(priceUsd > 0) || !(priceQuote > 0) || !Number.isFinite(priceUsd) || !Number.isFinite(priceQuote)) return null;
  return { priceUsd, priceQuote, quoteSymbol: t.Pair?.QuoteToken?.Symbol ?? null, quoteUsd: priceUsd / priceQuote };
}

const AGGREGATOR_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/** Harga dari slot0 pool v4 (hanya pasca-graduation). Harga dalam unit quote; USD hanya kalau quote = ETH dan ada feed. */
async function fetchOnChain(): Promise<{ priceQuote: number; quoteIsEth: boolean; quoteUsd: number | null } | null> {
  const key = wagePoolKey();
  const state = await readPoolState(publicClient, key.poolId);
  if (!state) return null; // pool belum ada (pra-graduation)

  const dec = await quoteDecimals(publicClient, key.quote);
  const priceQuote = quotePerWage(state.sqrtPriceX96, key.wageIsToken0, dec);
  if (!Number.isFinite(priceQuote) || priceQuote <= 0) return null;

  const quoteIsEth = key.quote === ZERO_ADDRESS;
  let quoteUsd: number | null = null;
  const feed = process.env.WEIGHHOUSE_ETH_USD_FEED as `0x${string}` | undefined;
  if (quoteIsEth && feed) {
    const [fdec, round] = await Promise.all([
      publicClient.readContract({ address: feed, abi: AGGREGATOR_ABI, functionName: "decimals" }),
      publicClient.readContract({ address: feed, abi: AGGREGATOR_ABI, functionName: "latestRoundData" }),
    ]);
    quoteUsd = Number(round[1]) / 10 ** Number(fdec);
  }
  return { priceQuote, quoteIsEth, quoteUsd };
}

export async function takePriceSnapshot() {
  const errors: string[] = [];
  const note = (label: string) => (e: unknown) => { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); return null; };

  const bq = await fetchFromBitquery().catch(note("bitquery"));
  const chain = bq ? null : await fetchOnChain().catch(note("on-chain price"));

  let snap: PriceSnap | null = null;
  let quoteUsd: number | null = null;

  if (bq) {
    quoteUsd = bq.quoteUsd;
    snap = {
      price_usd: bq.priceUsd,
      price_eth: bq.quoteSymbol && ETH_SYMBOLS.has(bq.quoteSymbol.toUpperCase()) ? bq.priceQuote : null,
      liquidity_usd: null, volume_wage: null, source: "bitquery",
    };
  } else if (chain) {
    quoteUsd = chain.quoteUsd;
    snap = {
      price_usd: chain.quoteUsd == null ? null : chain.priceQuote * chain.quoteUsd,
      price_eth: chain.quoteIsEth ? chain.priceQuote : null,
      liquidity_usd: null, volume_wage: null, source: "on-chain",
    };
  }
  if (!snap) return { ok: false as const, skipped: "no price source available", errors };

  // Liquidity (brief §4A): cadangan sisi quote -- curve pra-graduation, pool v4 pasca-graduation -- dalam USD.
  // Reserve dibaca on-chain; kurs USD quote diturunkan dari harga yang sama (tanpa feed tambahan).
  if (quoteUsd != null) {
    const reserve = await readQuoteReserve(publicClient).catch(note("liquidity"));
    if (reserve) snap.liquidity_usd = (Number(reserve.raw) / 10 ** reserve.decimals) * quoteUsd;
  }

  const { error } = await createServiceRoleClient()
    .from("price_snapshots")
    .insert({ taken_at: new Date().toISOString(), ...snap } as never);
  // `impliedQuoteUsd` ikut dikembalikan agar kewajarannya mudah dicek pada run pertama (untuk quote ETH harus ~ harga ETH).
  return error ? { ok: false as const, error: error.message, errors } : { ok: true as const, snap, impliedQuoteUsd: quoteUsd, errors };
}
