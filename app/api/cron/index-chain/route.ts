import { NextResponse, type NextRequest } from "next/server";
import { runIndexer } from "@/lib/weighhouse/indexer";
import { takeSupplySnapshot } from "@/lib/weighhouse/supply";
import { takePriceSnapshot } from "@/lib/weighhouse/price";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Dipanggil Supabase pg_cron tiap 1 menit (lihat supabase/migrations/0016_weighhouse_cron.sql).
 *  Dilindungi CRON_SECRET: pemanggil mengirim `Authorization: Bearer $CRON_SECRET`.
 *  Tanpa secret terkonfigurasi -> ditolak. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const index = await runIndexer().catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
  const supply = await takeSupplySnapshot().catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));

  // Harga cukup tiap 5 menit (brief §5.2): jalan hanya di menit kelipatan 5.
  const priceDue = new Date().getUTCMinutes() % 5 === 0;
  const price = priceDue ? await takePriceSnapshot().catch((e) => ({ ok: false as const, error: String(e?.message ?? e) })) : { skipped: "not due" };

  return NextResponse.json({ index, supply: "ok" in supply ? { ok: supply.ok } : supply, price });
}
