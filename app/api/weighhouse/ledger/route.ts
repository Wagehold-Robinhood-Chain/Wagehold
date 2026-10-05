import { NextResponse, type NextRequest } from "next/server";
import { getLedger } from "@/lib/weighhouse/metrics";

export async function GET(req: NextRequest) {
  const out = await getLedger(Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50);
  return NextResponse.json(out, {
    headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=15" },
  });
}
