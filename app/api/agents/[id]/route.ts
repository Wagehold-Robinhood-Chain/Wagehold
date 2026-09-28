import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAgentById } from "@/lib/supabase/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await getAgentById(supabase, id);

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  }

  return NextResponse.json({ agent: data });
}
