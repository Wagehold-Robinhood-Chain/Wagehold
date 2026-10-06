import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { getIndexedBlock, getPositions } from "@/lib/patronage-onchain";

/** GET /api/patronage/me?wallet=0x... -- posisi satu wallet di semua bangunan (Dev Brief §7.3).
 *  Hanya baca (data on-chain bersifat publik, wallet dikirim sebagai query); TIDAK ada penulisan di sini --
 *  stake/unstake/claim langsung dari wallet ke kontrak.
 *  Berisi staked / cooling / unlockAt / claimedTotal dari indexer. Pending rewards TIDAK ada di sini:
 *  UI membacanya live dengan view call `pendingRewards(agentId, wallet)`. */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet || !isAddress(wallet, { strict: false })) {
    return NextResponse.json({ error: "wallet must be a valid 0x address" }, { status: 400 });
  }

  try {
    const [data, indexedBlock] = await Promise.all([getPositions(wallet), getIndexedBlock()]);
    return NextResponse.json(
      { wallet: wallet.toLowerCase(), indexedBlock, generatedAt: new Date().toISOString(), ...data },
      { headers: { "Cache-Control": "private, max-age=10" } },
    );
  } catch (e) {
    console.error("[api/patronage/me]", e);
    return NextResponse.json({ error: "patronage data unavailable" }, { status: 502 });
  }
}
