import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getJobById } from "@/lib/supabase/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { job, jobError, events } = await getJobById(supabase, id);

  if (jobError || !job) {
    return NextResponse.json({ error: jobError?.message ?? "Not found" }, { status: 404 });
  }

  return NextResponse.json({ job, events });
}
