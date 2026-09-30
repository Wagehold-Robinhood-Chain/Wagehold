'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { JobCard } from '@/components/job-card';
import { Panel, PanelHeader, PanelScroll } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Chip } from '@/components/ui/chip';
import { ProgressBar } from '@/components/ui/progress-bar';
import { RANK_LABEL } from '@/types/domain';
import { activeChain } from '@/lib/web3/chains';
import { sendBack, setTheSeal } from '@/lib/web3/set-the-seal';
import { ConnectWalletLink } from '@/components/wallet-connect';
import type { JobSummary, Rank } from '@/types/domain';

export interface JobDetailEvent {
  id: string;
  actorLabel: string;
  text: string;
  /** Sudah diformat di server (Server Component) supaya tidak ada risiko
   *  mismatch locale/timezone antara render server dan client. */
  atLabel: string;
  /** Tx hash on-chain kalau event ini berasal dari transaksi (lock wage,
   *  seal, split) -- dirender sebagai link ke explorer. */
  tx?: string | null;
}

export interface JobAgentInfo {
  id: string;
  name: string;
  code: string;
  rank: Rank;
}

const STAGES = [
  { at: 0, label: 'Warden is choosing a Wright' },
  { at: 15, label: 'Brief assigned to a Wright' },
  { at: 30, label: 'Reading the brief' },
  { at: 45, label: 'Drafting the report' },
  { at: 70, label: 'Checking the draft' },
  { at: 95, label: 'Finalizing the deliverable' },
] as const;

/** Info kerja agent selama job belum siap di-seal: tahap yang sedang jalan
 *  (diturunkan dari progress yang naik live lewat Realtime). */
function WorkProgress({ job }: { job: JobSummary }) {
  const waiting = job.status === 'open';
  return (
    <Panel>
      <PanelHeader title="Work in progress" />
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        <p className="text-[12.5px] text-muted">
          {waiting
            ? 'The Warden is choosing the best Wright for this brief. This takes about 30 seconds, and this page updates by itself.'
            : `${job.agentCode || 'Your Wright'} is working on your brief. You can stay here or come back later — you will only be asked to seal once the deliverable is ready.`}
        </p>
        <ProgressBar value={job.progress} />
        <ul className="flex flex-col gap-1.5">
          {STAGES.map((st, i) => {
            const next = STAGES[i + 1]?.at ?? 101;
            const done = job.progress >= next;
            const active = job.progress >= st.at && !done;
            return (
              <li
                key={st.label}
                className={
                  done
                    ? 'flex items-center gap-2 text-[12px] text-muted'
                    : active
                      ? 'flex items-center gap-2 text-[12px] text-text'
                      : 'flex items-center gap-2 text-[12px] text-faint'
                }
              >
                <span className="w-3 text-center font-mono">
                  {done ? '✓' : active ? '…' : '·'}
                </span>
                {st.label}
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

export function JobDetail({
  job,
  brief,
  deliverable,
  agent,
  events,
  isOwnJob,
  needsWallet,
}: {
  job: JobSummary;
  brief: string;
  /** Hasil kerja Wright -- baru ada untuk Research Ward (Fase 1 item 10).
   *  null selama status belum 'review'/'paid', atau di Ward yang belum
   *  punya runtime sendiri. */
  deliverable: string | null;
  agent: JobAgentInfo | null;
  events: JobDetailEvent[];
  isOwnJob: boolean;
  /** true di mode wallet selama belum ada wallet terhubung. Selalu false di mode simulasi. */
  needsWallet: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<string | undefined>();

  async function callAction(
    path: 'approve' | 'revise',
    noteOrRating?: string | number,
  ) {
    setBusy(true);
    setError('');

    try {
      if (path === 'approve') {
        // Fase 2 item 7: kalau wage terkunci on-chain, ini juga mengirim
        // approve() dari wallet client -- lihat lib/web3/set-the-seal.ts.
        await setTheSeal(
          job,
          setStep,
          typeof noteOrRating === 'number' ? noteOrRating : undefined,
        );
      } else {
        const note = typeof noteOrRating === 'string' ? noteOrRating : '';
        await sendBack(job, note, setStep);
      }
      // Job dan Ledger di bawah sama-sama Server Component -- refresh
      // menarik ulang status, progress, dan event terbaru sekaligus.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
      setStep(undefined);
    }
  }

  // Job yang sudah di-seal terlihat di daftar oleh semua orang, tapi isinya
  // (brief, deliverable, ledger, escrow) hanya untuk client yang membuatnya.
  const locked = job.status === 'paid' && !isOwnJob;

  if (locked) {
    return (
      <div className="flex flex-col gap-3">
        <Panel>
          <PanelHeader title="Job" />
          <JobCard job={job} linkToDetail={false} locked />
          <div className="flex flex-col gap-2 px-3.5 py-3">
            <p className="text-[13px] text-muted">
              This job has been sealed. Its brief, deliverable and ledger are
              private to the client who posted it.
            </p>
            {needsWallet && (
              <p className="text-[11.5px] text-faint">
                <ConnectWalletLink /> the wallet that posted this job to view
                its details.
              </p>
            )}
            {agent && (
              <Link
                href={`/agents/${agent.id}`}
                className="flex w-fit items-center gap-2 text-[13px] text-text hover:underline"
              >
                <span>{agent.name}</span>
                <Chip variant="sigil">{agent.code}</Chip>
                <Chip variant="rank">{RANK_LABEL[agent.rank]}</Chip>
              </Link>
            )}
          </div>
        </Panel>
      </div>
    );
  }

  const deliverablePanel = deliverable ? (
    <Panel>
      <PanelHeader title="Deliverable" />
      <PanelScroll className="max-h-96">
        <p className="whitespace-pre-wrap px-3.5 py-3 text-[13px] text-muted">
          {deliverable}
        </p>
      </PanelScroll>
    </Panel>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Saat review: hasil kerja tampil DULU, baru gerbang seal di bawahnya. */}
      {job.status === 'review' && deliverablePanel}

      <Panel>
        <PanelHeader title="Job" />
        <JobCard
          job={job}
          isOwnJob={isOwnJob}
          busy={busy}
          busyLabel={step}
          error={error}
          linkToDetail={false}
          onSetSeal={(rating) => callAction('approve', rating)}
          onSendBack={(note) => callAction('revise', note)}
        />

        {needsWallet && job.status === 'review' && (
          <p className="border-b border-line bg-surface-2 px-3.5 py-2 text-[11.5px] text-faint">
            <ConnectWalletLink /> the wallet that posted this job to set the
            seal.
          </p>
        )}

        <div className="flex flex-col gap-2 border-b border-line px-3.5 py-3">
          <h3 className="text-[11px] uppercase tracking-wider text-faint">
            Brief
          </h3>
          <p className="whitespace-pre-wrap text-[13px] text-muted">{brief}</p>
        </div>

        {job.escrowTx && (
          <div className="flex flex-col gap-2 border-b border-line px-3.5 py-3">
            <h3 className="text-[11px] uppercase tracking-wider text-faint">
              Escrow
            </h3>
            <a
              href={`${activeChain.blockExplorers.default.url}/tx/${job.escrowTx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-fit font-mono text-[12px] text-muted underline hover:text-text"
            >
              {job.escrowTx.slice(0, 10)}…{job.escrowTx.slice(-6)} ↗
            </a>
          </div>
        )}

        {agent && (
          <div className="flex flex-col gap-2 px-3.5 py-3">
            <h3 className="text-[11px] uppercase tracking-wider text-faint">
              Wright
            </h3>
            <Link
              href={`/agents/${agent.id}`}
              className="flex w-fit items-center gap-2 text-[13px] text-text hover:underline"
            >
              <span>{agent.name}</span>
              <Chip variant="sigil">{agent.code}</Chip>
              <Chip variant="rank">{RANK_LABEL[agent.rank]}</Chip>
            </Link>
          </div>
        )}
      </Panel>

      {(job.status === 'open' || job.status === 'working') && (
        <WorkProgress job={job} />
      )}

      {job.status !== 'review' && deliverablePanel}

      <Panel>
        <PanelHeader title="Ledger" />
        <PanelScroll className="max-h-72">
          {events.length === 0 ? (
            <EmptyState>
              Nothing carved into the wall for this job yet.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-1.5 p-3">
              {/* Event baru dari Realtime fade in dari bawah; render awal tanpa animasi */}
              <AnimatePresence initial={false}>
                {events.map((e) => (
                  <motion.li
                    key={e.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="rounded-md border border-white/[0.06] bg-bg/60 px-2 py-1.5 text-[11.5px] text-muted"
                  >
                    <span className="font-medium text-text">
                      {e.actorLabel}
                    </span>{' '}
                    {e.text}
                    {e.tx && (
                      <a
                        href={`${activeChain.blockExplorers.default.url}/tx/${e.tx}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1.5 font-mono text-[10.5px] text-muted underline hover:text-text"
                      >
                        {e.tx.slice(0, 8)}…{e.tx.slice(-4)} ↗
                      </a>
                    )}
                    <div className="mt-0.5 font-mono text-[10px] text-faint">
                      {e.atLabel}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </PanelScroll>
      </Panel>
    </div>
  );
}
