import { NextResponse, type NextRequest } from "next/server";
import { getTopBuildings, parseWindow } from "@/lib/weighhouse/metrics";

export async function GET(req: NextRequest) {
  const out = await getTopBuildings(parseWindow(req.nextUrl.searchParams.get("window")));
  return NextResponse.json(out, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" },
  });
}
