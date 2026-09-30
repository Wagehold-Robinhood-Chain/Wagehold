'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Panel, PanelHeader, PanelScroll } from '@/components/ui/panel';
import { JobBoardEmpty } from '@/components/job-board-empty';
import { Button } from '@/components/ui/button';
import { JobTabs, type JobTab } from '@/components/job-tabs';
import { JobCard } from '@/components/job-card';
import { sendBack, setTheSeal } from '@/lib/web3/set-the-seal';
import { ConnectWalletLink } from '@/components/wallet-connect';
import { itemVariants } from '@/components/motion/primitives';
import type { Variants } from 'motion/react';
import type { JobSummary } from '@/types/domain';

export interface JobBoardItem {
  job: JobSummary;
  /** true kalau identitas ini (wallet / browser) adalah pemilik job -- syarat gerbang seal */
  isOwnJob: boolean;
}

// Empat tab sesuai wagehold-handoff.md §3. 'revision' tidak dapat tab sendiri
// karena reviseJob() mengembalikan job langsung ke 'working' (lihat
// lib/supabase/queries.ts), dan 'disputed'/'cancelled' belum ada alur UI-nya.
// Jeda kecil supaya kartu tidak mulai muncul sebelum Panel-nya sendiri selesai fade in.
const listVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.12 } },
};

const TAB_ORDER = ['review', 'working', 'open', 'paid'] as const;
type TabId = (typeof TAB_ORDER)[number];

const TAB_LABEL: Record<TabId, string> = {
  review: 'Awaiting seal',
  working: 'In progress',
  open: 'Open',
  paid: 'Sealed',
};

export function JobBoard({
  items: allItems,
  needsWallet,
}: {
  items: JobBoardItem[];
  /** true di mode wallet selama belum ada wallet terhubung -- board kosong
   *  dan mengajak connect. Selalu false di mode simulasi. */
  needsWallet: boolean;
}) {
  const router = useRouter();
  // Job Board per pemilik: tab Awaiting seal / In progress / Open hanya berisi job
  // milik wallet / browser ini. Tab Sealed pengecualian: menampilkan seal SEMUA
  // orang (transparansi kota), tapi detailnya terkunci untuk yang bukan pemilik
  // (lihat `locked` di JobCard dan gerbang di JobDetail).
  const items = useMemo(
    () => allItems.filter((i) => (i.job.status === 'paid' ? true : i.isOwnJob)),
    [allItems],
  );
  const [tab, setTab] = useState<TabId>('review');
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [steps, setSteps] = useState<Record<string, string | undefined>>({});

  const counts = useMemo(() => {
    const c: Record<TabId, number> = {
      review: 0,
      working: 0,
      open: 0,
      paid: 0,
    };
    for (const { job } of items) {
      if (job.status in c) c[job.status as TabId] += 1;
    }
    return c;
  }, [items]);

  const tabs: JobTab[] = TAB_ORDER.map((id) => ({
    id,
    label: TAB_LABEL[id],
    count: counts[id],
    alert: id === 'review',
  }));

  const visible = items.filter(({ job }) => job.status === tab);
  // Tab Sealed terbuka untuk semua, jadi tidak perlu wallet untuk melihatnya.
  const showConnectPrompt = needsWallet && tab !== 'paid';

  async function callJobAction(
    job: JobSummary,
    path: 'approve' | 'revise',
    noteOrRating?: string | number,
  ) {
    const jobId = job.id;
    setPending((p) => ({ ...p, [jobId]: true }));
    setErrors((e) => ({ ...e, [jobId]: '' }));

    try {
      if (path === 'approve') {
        // Fase 2 item 7: kalau wage terkunci on-chain, ini juga mengirim
        // approve() dari wallet client -- lihat lib/web3/set-the-seal.ts.
        await setTheSeal(
          job,
          (label) => setSteps((s) => ({ ...s, [jobId]: label })),
          typeof noteOrRating === 'number' ? noteOrRating : undefined,
        );
      } else {
        const note = typeof noteOrRating === 'string' ? noteOrRating : '';
        await sendBack(job, note, (label) =>
          setSteps((s) => ({ ...s, [jobId]: label })),
        );
      }
      // Refetch data server-side -- lebih sederhana daripada patch state lokal,
      // dan City Dashboard sudah pakai pola revalidate = 0 yang sama.
      router.refresh();
    } catch (err) {
      setErrors((e) => ({
        ...e,
        [jobId]: err instanceof Error ? err.message : 'Something went wrong',
      }));
    } finally {
      setPending((p) => ({ ...p, [jobId]: false }));
      setSteps((s) => ({ ...s, [jobId]: undefined }));
    }
  }

  return (
    <Panel className="h-full">
      <PanelHeader
        title="Your jobs"
        action={
          <Link href="/jobs/new">
            <Button variant="primary" size="small">
              Post a job
            </Button>
          </Link>
        }
      />
      <JobTabs
        tabs={tabs}
        active={tab}
        onChange={(id) => setTab(id as TabId)}
      />

      {needsWallet && !showConnectPrompt && (
        <p className="border-b border-line bg-surface-2 px-3.5 py-2 text-[11.5px] text-faint">
          <ConnectWalletLink /> to see and manage your own jobs.
        </p>
      )}

      <PanelScroll>
        {showConnectPrompt ? (
          <JobBoardEmpty kind="wallet" />
        ) : visible.length === 0 ? (
          <JobBoardEmpty kind={tab} />
        ) : (
          // key={tab}: ganti tab = daftar dibangun ulang, kartu muncul berurutan.
          // Job yang pindah tab lewat Realtime (mis. review -> paid) mengecil & hilang
          // dulu (exit), dan job baru yang masuk ke tab ini ikut fade in.
          <motion.div
            key={tab}
            className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3"
            variants={listVariants}
            initial="hidden"
            animate="visible"
          >
            <AnimatePresence>
              {visible.map(({ job, isOwnJob }) => (
                <motion.div
                  key={job.id}
                  variants={itemVariants}
                  exit={{
                    opacity: 0,
                    height: 0,
                    transition: { duration: 0.25 },
                  }}
                  className="overflow-hidden rounded-xl"
                >
                  <JobCard
                    job={job}
                    card
                    isOwnJob={isOwnJob}
                    locked={job.status === 'paid' && !isOwnJob}
                    busy={pending[job.id]}
                    busyLabel={steps[job.id]}
                    error={errors[job.id]}
                    onSetSeal={(rating) =>
                      callJobAction(job, 'approve', rating)
                    }
                    onSendBack={(note) => callJobAction(job, 'revise', note)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </PanelScroll>
    </Panel>
  );
}
