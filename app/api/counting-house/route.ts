import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCountingHouse } from "@/lib/supabase/queries";

/**
 * Counting House (tithe + reward yang dialihkan ke treasury) dari event on-chain yang sudah diindeks.
 * Read-only. Dipolling City Dashboard tiap 60 detik; hasil di-cache 30 detik di edge.
 * Gagal baca -> 503 dan dashboard mempertahankan angka terakhir.
 */
export async function GET() {
  const data = await getCountingHouse(createServiceRoleClient()).catch(() => null);
  if (!data) return NextResponse.json({ error: "Counting House is unavailable" }, { status: 503 });
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" },
  });
}
