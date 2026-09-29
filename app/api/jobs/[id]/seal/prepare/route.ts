import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isCouncilConfigured, preparePayeeOnChain } from "@/lib/web3/council";
import { isOnChainEscrowConfigured } from "@/lib/web3/strongbox";
import { authorizeJobOwner } from "@/lib/identity/server";
import { sealDetail } from "@/lib/identity/wallet-auth";

/**
 * Fase 2 item 7 -- step 1 of "Set the seal" for a job whose wage is locked
 * on-chain. `WageholdStrongbox.approve` reverts until the council has wired
 * a payee, so before the client's wallet sends `approve()` the browser calls
 * this route; it wires the payee (and registers the job with the Splitter)
 * using the server's council key. The payee comes from the database (the
 * Wright assigned to this job), never from the request.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("client_id, status, escrow_tx, agent_id")
    .eq("id", id)
    .single();

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Tanpa login: pemilik dibuktikan lewat tanda tangan wallet (sama dengan yang
  // nanti dikirim ke /approve -- rating ikut ditandatangani).
  const body = await request.json().catch(() => null);
  const rating =
    typeof body?.rating === "number" && Number.isInteger(body.rating) ? body.rating : undefined;
  const owner = await authorizeJobOwner({
    clientId: job.client_id,
    action: "seal",
    jobId: id,
    detail: sealDetail(rating),
    auth: body?.auth,
    verb: "set the seal",
  });
  if (!owner.ok) {
    return NextResponse.json({ error: owner.error }, { status: owner.status });
  }
  if (job.status !== "review") {
    return NextResponse.json(
      { error: `Job is '${job.status}', not awaiting seal` },
      { status: 409 }
    );
  }
  if (!job.escrow_tx) {
    return NextResponse.json(
      { error: "This job's wage isn't locked on-chain, so there is nothing to prepare" },
      { status: 400 }
    );
  }
  if (!job.agent_id) {
    return NextResponse.json({ error: "No Wright is assigned to this job" }, { status: 409 });
  }
  if (!isOnChainEscrowConfigured || !isCouncilConfigured) {
    return NextResponse.json(
      {
        error:
          "On-chain sealing isn't configured on the server (needs the Strongbox addresses and COUNCIL_PRIVATE_KEY).",
      },
      { status: 503 }
    );
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("wallet")
    .eq("id", job.agent_id)
    .single();

  try {
    const { state } = await preparePayeeOnChain(id, agent?.wallet);
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[seal/prepare]", id, err);
    return NextResponse.json(
      { error: `Could not prepare the payee on-chain: ${message}` },
      { status: 502 }
    );
  }
}
