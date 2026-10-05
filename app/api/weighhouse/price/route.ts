import { NextResponse, type NextRequest } from "next/server";
import { getPriceSeries } from "@/lib/weighhouse/metrics";

export async function GET(req: NextRequest) {
  const r = req.nextUrl.searchParams.get("range");
  const out = await getPriceSeries(r === "24h" || r === "30d" ? r : "7d");
  return NextResponse.json(out, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" },
  });
}
