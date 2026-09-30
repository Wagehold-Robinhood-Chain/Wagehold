import Link from "next/link";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { SiteNav } from "@/components/site-nav";
import { WalletConnect } from "@/components/wallet-connect";
import { PostJobClient } from "@/components/post-job-client";
import { createClient } from "@/lib/supabase/server";
import { listAgents } from "@/lib/supabase/queries";
import { WARD_LABEL } from "@/types/domain";
import type { DistrictId } from "@/types/domain";
import { MotionPage, MotionHeader, MotionFooter } from "@/components/motion/primitives";

const VALID_DISTRICTS = Object.keys(WARD_LABEL) as DistrictId[];

export default async function PostJobPage({
  searchParams,
}: {
  searchParams: Promise<{ district?: string; agent?: string }>;
}) {
  const { district, agent } = await searchParams;

  // Bangunan yang bisa di-hire langsung: Wright saja (Warden hanya me-routing).
  const supabase = await createClient();
  const { data: agentRows } = await listAgents(supabase);
  const buildings = (agentRows ?? [])
    .filter((a) => !a.is_lead)
    .map((a) => ({ id: a.id, name: a.name, code: a.code, district: a.district }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Datang dari tombol "Hire {nama}" (?agent=) -- prefill bangunan sekaligus Ward-nya.
  // ?district= (Warden / link lama) hanya mem-prefill Ward. Nilai tidak valid diabaikan
  // diam-diam (lihat catatan di PostJobForm).
  const hired = buildings.find((b) => b.id === agent);
  const initialAgentId = hired?.id;
  const initialDistrict = hired
    ? hired.district
    : VALID_DISTRICTS.includes(district as DistrictId)
      ? (district as DistrictId)
      : undefined;

  return (
    <MotionPage className="flex h-screen flex-col gap-3 p-3">
      <MotionHeader className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-bold tracking-tight">Wagehold</h1>
        <SiteNav />
        <p className="text-[13px] italic text-muted">Work sealed. Wages shared.</p>
        <WalletConnect />
      </MotionHeader>

      <div className="flex flex-1 items-start justify-center overflow-auto py-2">
        <div className="w-full max-w-xl">
          <Panel>
            <PanelHeader
              title="Post a job"
              action={
                <Link href="/jobs">
                  <Button size="small">Cancel</Button>
                </Link>
              }
            />
            {/* Clarity rule (lore file §8): pertama kali istilah lore muncul
                di layar, sandingkan dengan arti polosnya. */}
            <p className="border-b border-line bg-surface-2 px-3.5 py-2 text-[11.5px] text-faint">
              The Gate: where clients enter to post jobs. The wage locks in the Strongbox
              (escrow) the moment you submit, and stays there until a Wright delivers and you
              set the seal.
            </p>
            <PostJobClient
              initialDistrict={initialDistrict}
              initialAgentId={initialAgentId}
              buildings={buildings}
            />
          </Panel>
        </div>
      </div>

      <MotionFooter className="text-center text-[11px] text-faint">
        No coin leaves the Hold without a human seal.
      </MotionFooter>
    </MotionPage>
  );
}
