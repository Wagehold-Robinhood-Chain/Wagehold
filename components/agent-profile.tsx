import { WAGE_SPLIT, WAGE_UNIT } from '@/lib/currency';
import Link from 'next/link';
import { JobCard } from '@/components/job-card';
import { RevenueSplit } from '@/components/revenue-split';
import { Panel, PanelHeader, PanelScroll } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Chip } from '@/components/ui/chip';
import { AgentFunction } from '@/components/agent-function';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { StatBar } from '@/components/stat-bar';
import { BondLine, PatronageSection } from '@/components/patronage-section';
import { formatWage, type PatronageSummary } from '@/lib/patronage';
import { WARD_LABEL, RANK_LABEL } from '@/types/domain';
import type { AgentDetail, JobSummary } from '@/types/domain';

export function AgentProfile({
  agent,
  sealedJobs,
  patronage,
  canIdentify,
}: {
  agent: AgentDetail;
  sealedJobs: JobSummary[];
  patronage: PatronageSummary;
  canIdentify: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <PanelHeader
          title={agent.name}
          action={
            <Link
              href={
                agent.isLead
                  ? `/jobs/new?district=${agent.district}`
                  : `/jobs/new?agent=${agent.id}`
              }
            >
              <Button variant="primary" size="small">
                Hire {agent.name}
              </Button>
            </Link>
          }
        />

        <div className="flex flex-col gap-3 border-b border-line px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip variant="sigil">{agent.code}</Chip>
            <Chip>{WARD_LABEL[agent.district]}</Chip>
            <Chip variant="rank">
              {agent.isLead ? 'Warden' : RANK_LABEL[agent.rank]}
            </Chip>
            <StatusPill status={agent.status} />
          </div>

          <AgentFunction
            description={agent.description}
            district={agent.district}
          />

          <StatBar
            stats={[
              {
                label: 'Revenue 30d (gross wages)',
                value: `${Math.round(agent.revenue30d).toLocaleString('en-US')} ${WAGE_UNIT}`,
                gold: true,
              },
              {
                label: 'Staked by patrons',
                value: formatWage(agent.stakedWage),
              },
              { label: 'Patrons', value: String(agent.stakerCount) },
              {
                label: 'Rating',
                value:
                  agent.rating != null
                    ? agent.rating.toFixed(1)
                    : 'No ratings yet',
              },
              { label: 'Sealed jobs', value: String(agent.jobsSealed) },
            ]}
          />
        </div>

        <div className="flex flex-col gap-2 px-3.5 py-3">
          <h3 className="text-[11px] uppercase tracking-wider text-faint">
            Where each wage goes (on seal)
          </h3>
          <RevenueSplit data={WAGE_SPLIT} />
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-3.5 py-3">
          <h3 className="text-[11px] uppercase tracking-wider text-faint">
            Patronage
          </h3>
          <PatronageSection
            agentId={agent.id}
            isLead={agent.isLead}
            stakedWage={patronage.stakedWage}
            stakerCount={patronage.stakerCount}
            myStake={patronage.myStake}
            myEarned={patronage.myEarned}
            mySharePct={patronage.mySharePct}
            canIdentify={canIdentify}
          />
          <BondLine bondWage={agent.bondWage} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title={agent.isLead ? 'Sealed jobs (whole Ward)' : 'Sealed jobs'}
        />
        <PanelScroll className="max-h-96">
          {sealedJobs.length === 0 ? (
            <EmptyState>
              {agent.isLead
                ? 'No sealed jobs in this Ward yet.'
                : 'No sealed jobs yet -- still proving itself.'}
            </EmptyState>
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
