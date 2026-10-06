import { NextResponse, type NextRequest } from "next/server";
import { POOL_WINDOW_DAYS, getIndexedBlock, getPool } from "@/lib/patronage-onchain";

/** GET /api/patronage/pools/:agentId -- satu pool + reward terbaru dengan tautan job (Dev Brief §7.3).
 *  `:agentId` = agents.id (uuid) atau bytes32 on-chain. ?limit= (1..100, default 20). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Number.isInteger(limitParam) && limitParam >= 1 && limitParam <= 100 ? limitParam : 20;

  try {
    const [found, indexedBlock] = await Promise.all([getPool(agentId, limit), getIndexedBlock()]);
    if (!found) return NextResponse.json({ error: "pool not found" }, { status: 404 });
    return NextResponse.json(
      { windowDays: POOL_WINDOW_DAYS, indexedBlock, generatedAt: new Date().toISOString(), ...found },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=15" } },
    );
  } catch (e) {
    console.error("[api/patronage/pools/:agentId]", e);
    return NextResponse.json({ error: "patronage data unavailable" }, { status: 502 });
  }
}
