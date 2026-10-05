import { NextResponse, type NextRequest } from "next/server";
import { getSummary, parseWindow } from "@/lib/weighhouse/metrics";

export async function GET(req: NextRequest) {
  const out = await getSummary(parseWindow(req.nextUrl.searchParams.get("window")));
  return NextResponse.json(out, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" },
  });
}
