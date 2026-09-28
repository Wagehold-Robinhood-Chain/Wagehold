"use client";

import { motion } from "motion/react";

export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="h-1 overflow-hidden rounded-sm bg-surface-2">
      <motion.div
        className="h-full bg-good"
        // Mulai dari 0 supaya bar "terisi" saat kartu pertama muncul,
        // lalu bergerak halus tiap progress berubah lewat Realtime.
        initial={{ width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  );
}
