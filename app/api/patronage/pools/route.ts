import { NextResponse, type NextRequest } from "next/server";
import { POOL_WINDOW_DAYS, getIndexedBlock, getPools, type PoolSort } from "@/lib/patronage-onchain";

/** GET /api/patronage/pools?sort=staked|wages7d -- semua bangunan Patronage (Dev Brief §7.3).
 *  Data dari indexer (tertinggal beberapa menit); `indexedBlock` menunjukkan sampai blok mana. Jumlah = string base unit. */
export async function GET(req: NextRequest) {
  const sortParam = req.nextUrl.searchParams.get("sort");
  if (sortParam !== null && sortParam !== "staked" && sortParam !== "wages7d") {
    return NextResponse.json({ error: "sort must be 'staked' or 'wages7d'" }, { status: 400 });
  }
  const sort: PoolSort = sortParam === "wages7d" ? "wages7d" : "staked";

  try {
    const [pools, indexedBlock] = await Promise.all([getPools(sort), getIndexedBlock()]);
    return NextResponse.json(
      { sort, windowDays: POOL_WINDOW_DAYS, indexedBlock, generatedAt: new Date().toISOString(), pools },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } },
    );
  } catch (e) {
    console.error("[api/patronage/pools]", e);
    return NextResponse.json({ error: "patronage data unavailable" }, { status: 502 });
  }
}
