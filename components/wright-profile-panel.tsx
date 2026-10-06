'use client';

import { WAGE_SPLIT, WAGE_UNIT, formatWage } from '@/lib/currency';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Panel, PanelHeader, PanelScroll } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Chip } from '@/components/ui/chip';
import { AgentFunction } from '@/components/agent-function';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { ProgressBar } from '@/components/ui/progress-bar';
import { RevenueSplit } from '@/components/revenue-split';
import { BondLine, PatronageSection } from '@/components/patronage-section';
import { SimulationHistory } from '@/components/simulation-history';
import { cn } from '@/lib/cn';
import { RANK_LABEL, WARD_COLOR_HEX, WARD_LABEL } from '@/types/domain';
import type { AgentDetail, JobSummary } from '@/types/domain';

function SectionLabel({ children }: { children: string }) {
  return (
    <h3 className="text-[10.5px] uppercase tracking-wider text-faint">
      {children}
    </h3>
  );
}

/**
 * Panel kiri City Dashboard (Wright profile, seperti di prototipe): muncul
 * saat sebuah gedung di kota diklik. Versi ringkas dari halaman
 * /agents/[id] -- link "Full profile" menuju halaman lengkapnya.
 */
export function WrightProfilePanel({
  agent,
  currentJob,
  sealedJobs,
  viewerId,
  className,
}: {
  agent: AgentDetail | null;
  currentJob: JobSummary | null;
  sealedJobs: JobSummary[];
  /** Identitas pengunjung (browser simulasi / wallet) -- untuk baris "Yours" di Simulation history. */
  viewerId: string | null;
  className?: string;
}) {
  return (
    <Panel className={className}>
      <PanelHeader
        title="Wright profile"
        action={
          <span className="text-[11.5px] text-faint">click a building</span>
        }
      />

      {!agent ? (
        <EmptyState>Click a building in the city to see its Wright.</EmptyState>
      ) : (
        <PanelScroll>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <div className="flex flex-col gap-2.5 border-b border-line px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip variant="sigil">{agent.code}</Chip>
                  <Chip>
                    <i
                      className="inline-block size-2 rounded-full"
                      style={{ background: WARD_COLOR_HEX[agent.district] }}
                    />
                    {WARD_LABEL[agent.district]}
                  </Chip>
                  <Chip variant="rank">
                    {agent.isLead ? 'Warden' : RANK_LABEL[agent.rank]}
                  </Chip>
                </div>
                <div>
                  <StatusPill status={agent.status} />
                </div>
                <h3 className="font-display text-xl font-bold tracking-tight text-text">
                  {agent.name}
                </h3>
                <AgentFunction
                  description={agent.description}
                  district={agent.district}
                />
              </div>

              <div className="grid grid-cols-2 border-b border-line">
                {[
                  {
                    label: 'Revenue 30d (gross wages)',
                    value: `${Math.round(agent.revenue30d).toLocaleString('en-US')} ${WAGE_UNIT}`,
                    gold: true,
                  },
                  {
                    label: 'Staked by patrons',
                    value: formatWage(agent.stakedWage),
                  },
                  {
                    label: 'Patrons',
                    value: agent.stakerCount.toLocaleString('en-US'),
                  },
                  {
                    label: 'Client rating',
                    value:
                      agent.rating != null
                        ? `${agent.rating.toFixed(1)} / 5`
                        : 'No ratings yet',
                  },
                  { label: 'Sealed jobs', value: String(agent.jobsSealed) },
                ].map((s, i) => (
                  <div
                    key={s.label}
                    className={cn(
                      'flex flex-col gap-0.5 px-3.5 py-2.5',
                      i % 2 === 0 && i !== 4 && 'border-r border-line',
                      i < 4 && 'border-b border-line',
                      i === 4 && 'col-span-2',
                    )}
                  >
                    <span className="text-[10.5px] uppercase tracking-wider text-faint">
                      {s.label}
                    </span>
                    <span
                      className={cn(
                        'font-mono text-[15px] tabular-nums',
                        s.gold ? 'text-gold' : 'text-text',
                      )}
                    >
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2 border-b border-line px-3.5 py-3">
                <SectionLabel>Current job</SectionLabel>
                {currentJob ? (
                  <>
                    <Link
                      href={`/jobs/${currentJob.id}`}
                      className="text-[13px] font-medium text-text hover:underline"
                    >
                      {currentJob.title}
                    </Link>
                    {currentJob.status === 'working' && (
                      <ProgressBar value={currentJob.progress} />
                    )}
                    <p className="text-[11.5px] text-muted">
                      {WARD_LABEL[currentJob.district]} ·{' '}
                      {currentJob.budgetUsdc.toLocaleString('en-US')}{' '}
                      {WAGE_UNIT} in the Strongbox
                      {currentJob.status === 'review' && ' · awaiting seal'}
                    </p>
                  </>
                ) : (
                  <p className="text-[12.5px] text-faint">
                    No active job. Open for hire.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 border-b border-line px-3.5 py-3">
                <SectionLabel>Where each wage goes (on seal)</SectionLabel>
                <RevenueSplit data={WAGE_SPLIT} />
              </div>

              <div className="flex flex-col gap-2 border-b border-line px-3.5 py-3">
                <SectionLabel>Patronage</SectionLabel>
                <PatronageSection agentId={agent.id} isLead={agent.isLead} />
                <BondLine bondWage={agent.bondWage} />
                <SimulationHistory agentId={agent.id} initialUserId={viewerId} />
              </div>

              <div className="flex flex-col gap-1.5 border-b border-line px-3.5 py-3">
                <SectionLabel>{`Sealed jobs · ${agent.jobsSealed} total${agent.isLead ? ' (whole Ward)' : ''}`}</SectionLabel>
                {sealedJobs.length === 0 ? (
                  <p className="text-[12.5px] text-faint">
                    No sealed jobs yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {sealedJobs.map((j) => (
                      <li
                        key={j.id}
                        className="flex items-start justify-between gap-2 text-[12px]"
                      >
                        <Link
                          href={`/jobs/${j.id}`}
                          className="text-muted hover:text-text hover:underline"
                        >
                          {j.title}
                        </Link>
                        <span className="whitespace-nowrap font-mono tabular-nums text-text">
                          {j.budgetUsdc.toLocaleString('en-US')} {WAGE_UNIT}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap gap-2 px-3.5 py-3">
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
                <Link href={`/agents/${agent.id}`}>
                  <Button size="small">Full profile</Button>
                </Link>
              </div>
            </motion.div>
          </AnimatePresence>
        </PanelScroll>
      )}
    </Panel>
  );
}
