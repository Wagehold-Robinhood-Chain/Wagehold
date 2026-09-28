"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Button } from "@/components/ui/button";
import { WARD_LABEL } from "@/types/domain";
import type { JobSummary } from "@/types/domain";

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
  onSetSeal?: () => void;
  /** Send back butuh catatan revisi (Article IV: setiap aksi tercatat) */
  onSendBack?: (note: string) => void;
}

export function JobCard({
  job,
  isOwnJob,
  busy,
  busyLabel,
  error,
  linkToDetail = true,
  onSetSeal,
  onSendBack,
}: JobCardProps) {
  const isReview = job.status === "review";
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState("");

  function confirmSendBack() {
    if (!note.trim()) return;
    onSendBack?.(note.trim());
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 border-b border-line px-3.5 py-3 transition-colors duration-500",
        isReview && "bg-warn/[0.06]"
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        {linkToDetail ? (
          <Link
            href={`/jobs/${job.id}`}
            className="text-[13.5px] font-medium text-text hover:underline"
          >
            {job.title}
          </Link>
        ) : (
          <span className="text-[13.5px] font-medium text-text">{job.title}</span>
        )}
        <span className="whitespace-nowrap font-mono text-[12.5px] tabular-nums text-text">
          {job.budgetUsdc.toLocaleString("en-US")} USDC
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted">
        <span>{WARD_LABEL[job.district]}</span>
        {job.agentTicker && <span>${job.agentTicker}</span>}
      </div>

      {job.status === "working" && <ProgressBar value={job.progress} />}

      {/* Gerbang seal <-> form "Send back" bergantian dengan fade pendek. `mode="wait"`
          = yang lama selesai keluar dulu, baru yang baru masuk (tanpa lompatan tinggi). */}
      <AnimatePresence mode="wait" initial={false}>
      {isReview && isOwnJob && !composing && (
        <motion.div
          key="gate"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className="flex flex-col gap-1.5"
        >
          <p className="text-[11.5px] text-warn">
            Awaiting your seal to release the wage.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="small" onClick={onSetSeal} disabled={busy}>
              {busy ? (busyLabel ?? "Setting the seal…") : "Set the seal"}
            </Button>
            <Button size="small" onClick={() => setComposing(true)} disabled={busy}>
              Send back
            </Button>
          </div>
        </motion.div>
      )}

      {isReview && isOwnJob && composing && (
        <motion.div
          key="compose"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className="flex flex-col gap-1.5"
        >
          <label className="text-[11px] text-muted">
            What needs to change before you can set the seal?
          </label>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='e.g. "Please add sources for the price claims."'
            className="min-h-16 resize-y rounded-md border border-line bg-bg px-2.5 py-1.5 text-[12.5px] text-text outline-none focus-visible:border-gold"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="small" onClick={confirmSendBack} disabled={busy || !note.trim()}>
              {busy ? "Sending back…" : "Confirm send back"}
            </Button>
            <Button
              size="small"
              onClick={() => {
                setComposing(false);
                setNote("");
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
