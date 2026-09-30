'use client';

import { WAGE_UNIT } from '@/lib/currency';
import { useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Button } from '@/components/ui/button';
import { WARD_LABEL } from '@/types/domain';
import { MAX_NOTE_LENGTH, buildAnswerTemplate } from '@/lib/continue-job';
import type { JobSummary } from '@/types/domain';

interface JobCardProps {
  job: JobSummary;
  /** true kalau job ini milik client yang sedang login -- menampilkan gerbang seal */
  isOwnJob?: boolean;
  /** true selagi set-the-seal/send-back sedang diproses -- menonaktifkan tombol */
  busy?: boolean;
  /** Label langkah yang sedang jalan selama Set the seal on-chain (mis.
   *  "Confirm in your wallet…"). Kosong -> label bawaan. */
  busyLabel?: string;
  /** pesan error dari permintaan set-the-seal/send-back terakhir, kalau gagal */
  error?: string;
  /** Judul job jadi link ke /jobs/[id] (Page D). Default true -- dimatikan
   *  saat JobCard dipakai *di dalam* Page D sendiri supaya tidak me-link ke
   *  dirinya sendiri. */
  linkToDetail?: boolean;
  /** true untuk job yang sudah di-seal milik orang lain: kartu tetap tampil di
   *  daftar, tapi judul tidak jadi link dan detailnya terkunci. */
  locked?: boolean;
  /** Rating (1-5) untuk Wright di job ini ikut dikirim saat Set the seal --
   *  dipakai untuk Client rating di Wright profile (lib/agent-stats.ts).
   *  Opsional: undefined kalau job tidak punya agent untuk di-rate. */
  onSetSeal?: (rating?: number) => void;
  /** Send back butuh catatan revisi (Article IV: setiap aksi tercatat) */
  onSendBack?: (note: string) => void;
  /** Isi deliverable -- dipakai untuk membaca bagian "Open questions" Wright dan
   *  mengisi awal catatan Send back dengan pertanyaan + baris jawaban. */
  deliverable?: string | null;
}

const RATING_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Great',
  5: 'Excellent',
};

/** Datang dari tombol "Review & seal" di Job Board (/jobs/[id]#seal):
 *  gulir langsung ke gerbang seal supaya rating bintang terlihat. */
function scrollToSealIfHashed(el: HTMLDivElement | null) {
  if (el && typeof window !== 'undefined' && window.location.hash === '#seal') {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

export function JobCard({
  job,
  isOwnJob,
  busy,
  busyLabel,
  error,
  linkToDetail = true,
  locked = false,
  onSetSeal,
  onSendBack,
  deliverable,
}: JobCardProps) {
  const isReview = job.status === 'review';
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState('');
  // Rating wajib kalau job punya Wright -- 0 = belum dipilih, tombol seal terkunci.
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0); // pratinjau bintang saat kursor di atasnya
  const needsRating = !!job.agentCode && rating === 0;
  const answerTemplate = buildAnswerTemplate(deliverable);
  const hasOpenQuestions = answerTemplate !== '';

  function confirmSendBack() {
    if (!note.trim()) return;
    onSendBack?.(note.trim());
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 border-b border-line px-3.5 py-3 transition-colors duration-500',
        isReview && 'bg-warn/[0.06]',
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        {linkToDetail && !locked ? (
          <Link
            href={`/jobs/${job.id}`}
            className="text-[13.5px] font-medium text-text hover:underline"
          >
            {job.title}
          </Link>
        ) : (
          <span className="text-[13.5px] font-medium text-text">
            {job.title}
          </span>
        )}
        <span className="whitespace-nowrap font-mono text-[12.5px] tabular-nums text-text">
          {job.budgetUsdc.toLocaleString('en-US')} {WAGE_UNIT}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted">
        <span>
          {WARD_LABEL[job.district]}
          {job.agentCode ? ` · ${job.agentCode}` : ''}
        </span>
      </div>

      {locked && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-faint">
          <span aria-hidden>🔒</span>
          <span>
            Sealed. Details are visible only to the client who posted it.
          </span>
        </p>
      )}

      {(job.status === 'open' || job.status === 'working') && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-good" />
          </span>
          <span>
            {job.status === 'open'
              ? 'The Warden is choosing a Wright…'
              : `${job.agentCode || 'A Wright'} is working on this brief · ${Math.round(job.progress)}%`}
          </span>
        </div>
      )}

      {(job.status === 'working' || job.status === 'open') && (
        <ProgressBar value={job.progress} />
      )}

      {/* Gerbang seal <-> form "Send back" bergantian dengan fade pendek. `mode="wait"`
          = yang lama selesai keluar dulu, baru yang baru masuk (tanpa lompatan tinggi). */}
      <AnimatePresence mode="wait" initial={false}>
        {isReview && isOwnJob && linkToDetail && (
          <motion.div
            key="review-link"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col gap-1.5"
          >
            <p className="text-[11.5px] text-warn">
              The Wright has delivered. Read the deliverable, rate the work (★)
              — required — then set the seal.
            </p>
            <Link href={`/jobs/${job.id}#seal`} className="w-fit">
              <Button variant="primary" size="small">
                Review &amp; seal
              </Button>
            </Link>
          </motion.div>
        )}

        {isReview && isOwnJob && !linkToDetail && !composing && (
          <motion.div
            key="gate"
            id="seal"
            ref={scrollToSealIfHashed}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col gap-1.5"
          >
            <p className="text-[11.5px] text-warn">
              Awaiting your seal to release the wage.
            </p>
            {job.agentCode && (
              <div
                className={cn(
                  'flex flex-col gap-2 rounded-lg border px-3 py-2.5 transition-colors',
                  rating === 0
                    ? 'border-gold/60 bg-gold/[0.08] shadow-[0_0_0_3px_rgba(230,195,106,0.10)]'
                    : 'border-good/50 bg-good/[0.07]',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[13px] font-semibold text-text">
                    Rate this Wright&apos;s work
                  </label>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                      rating === 0
                        ? 'bg-gold text-gold-ink'
                        : 'bg-good/20 text-good',
                    )}
                  >
                    {rating === 0 ? 'Required' : 'Done'}
                  </span>
                </div>
                <div
                  className="flex items-center gap-1.5"
                  role="radiogroup"
                  onMouseLeave={() => setHoverRating(0)}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={rating === n}
                      aria-label={`${n} -- ${RATING_LABELS[n]}`}
                      disabled={busy}
                      onMouseEnter={() => setHoverRating(n)}
                      onFocus={() => setHoverRating(n)}
                      onBlur={() => setHoverRating(0)}
                      onClick={() => setRating(rating === n ? 0 : n)}
                      className={cn(
                        'text-[30px] leading-none transition-all duration-150 hover:scale-125 active:scale-95 disabled:opacity-60',
                        n <= (hoverRating || rating)
                          ? 'text-gold drop-shadow-[0_0_6px_rgba(230,195,106,0.55)]'
                          : 'text-gold/30',
                        rating === 0 && hoverRating === 0 && 'animate-pulse',
                      )}
                    >
                      ★
                    </button>
                  ))}
                  <span className="ml-2 min-w-16 text-[13px] font-semibold text-gold">
                    {RATING_LABELS[hoverRating || rating] ?? ''}
                  </span>
                </div>
              </div>
            )}
            {needsRating && (
              <p className="text-[11.5px] text-warn">
                Tap a star to rate the work. “Set the seal” unlocks after you
                rate.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="small"
                onClick={() => onSetSeal?.(rating > 0 ? rating : undefined)}
                disabled={busy || needsRating}
                title={needsRating ? 'Rate the Wright first' : undefined}
              >
                {busy ? (busyLabel ?? 'Setting the seal…') : 'Set the seal'}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  // Buka form dengan pertanyaan Wright sebagai isi awal (kalau ada
                  // dan kotaknya masih kosong) supaya tinggal diisi jawabannya.
                  if (!note.trim() && hasOpenQuestions) setNote(answerTemplate);
                  setComposing(true);
                }}
                disabled={busy}
              >
                {hasOpenQuestions ? 'Answer & send back' : 'Send back'}
              </Button>
            </div>
          </motion.div>
        )}

        {isReview && isOwnJob && !linkToDetail && composing && (
          <motion.div
            key="compose"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col gap-1.5"
          >
            <label className="text-[11px] text-muted">
              {hasOpenQuestions
                ? 'Answer the Wright’s open questions, or say what needs to change before you can set the seal.'
                : 'What needs to change before you can set the seal?'}
            </label>
            <textarea
              autoFocus
              value={note}
              maxLength={MAX_NOTE_LENGTH}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                hasOpenQuestions
                  ? 'e.g. "Focus on token X over the last 30 days."'
                  : 'e.g. "Please add sources for the price claims."'
              }
              className={cn(
                'resize-y rounded-md border border-line bg-bg px-2.5 py-1.5 text-[12.5px] text-text outline-none focus-visible:border-gold',
                hasOpenQuestions ? 'min-h-32' : 'min-h-16',
              )}
            />
            <div className="flex items-center justify-between gap-2 text-[10.5px] text-faint">
              <span>
                The same Wright reworks the report. Each send back counts toward
                5 per job.
              </span>
              <span className="font-mono tabular-nums">
                {note.length}/{MAX_NOTE_LENGTH}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="small"
                onClick={confirmSendBack}
                disabled={busy || !note.trim()}
              >
                {busy
                  ? 'Sending back…'
                  : hasOpenQuestions
                    ? 'Send answers back'
                    : 'Confirm send back'}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setComposing(false);
                  setNote('');
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.p
            key="error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="text-[11.5px] text-crit"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
