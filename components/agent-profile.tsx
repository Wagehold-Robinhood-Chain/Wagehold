import Link from "next/link";
import { JobCard } from "@/components/job-card";
import { RevenueSplit } from "@/components/revenue-split";
import { Panel, PanelHeader, PanelScroll } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { StatBar } from "@/components/stat-bar";
import { WARD_LABEL, RANK_LABEL } from "@/types/domain";
import type { AgentDetail, JobSummary } from "@/types/domain";

// Split tetap sesuai Charter Article VI/VII/VIII (lore file §6) -- bukan
// per-agent, jadi tidak datang dari tabel agents.
const FIXED_SPLIT = { patronsPct: 70, lampOilPct: 20, tithePct: 10 };

export function AgentProfile({
  agent,
  sealedJobs,
}: {
  agent: AgentDetail;
  sealedJobs: JobSummary[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <PanelHeader
          title={agent.name}
          action={
            <Link href={`/jobs/new?district=${agent.district}`}>
              <Button variant="primary" size="small">
                Hire ${agent.ticker}
              </Button>
            </Link>
          }
        />

        <div className="flex flex-col gap-3 border-b border-line px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip variant="ticker">${agent.ticker}</Chip>
            <Chip>{WARD_LABEL[agent.district]}</Chip>
            <Chip variant="rank">{agent.isLead ? "Warden" : RANK_LABEL[agent.rank]}</Chip>
            <StatusPill status={agent.status} />
          </div>

          <p className="text-[13px] text-muted">{agent.description}</p>

          <StatBar
            stats={[
              {
                label: "Revenue (30d)",
                value: `${Math.round(agent.revenue30d).toLocaleString("en-US")} USDC`,
                gold: true,
              },
              { label: "Patrons", value: String(agent.holders) },
              { label: "Rating", value: agent.rating.toFixed(1) },
              { label: "Sealed jobs", value: String(agent.jobsSealed) },
            ]}
          />
        </div>

        <div className="flex flex-col gap-2 px-3.5 py-3">
          <h3 className="text-[11px] uppercase tracking-wider text-faint">
            Wage split (escrow release)
          </h3>
          <RevenueSplit data={FIXED_SPLIT} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Sealed jobs" />
        <PanelScroll className="max-h-96">
          {sealedJobs.length === 0 ? (
            <EmptyState>No sealed jobs yet -- still proving itself.</EmptyState>
          ) : (
            <div className="flex flex-col">
              {sealedJobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </PanelScroll>
      </Panel>
    </div>
  );
}
