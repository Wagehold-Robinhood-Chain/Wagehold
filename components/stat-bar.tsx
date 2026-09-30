"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

export interface Stat {
  label: string;
  value: string;
  gold?: boolean;
  /** Warna merah (Furnace = yang dibakar). */
  crit?: boolean;
}

export function StatBar({ stats }: { stats: Stat[] }) {
  return (
    <div className="flex w-full flex-nowrap gap-x-6 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:ml-auto sm:w-auto sm:flex-wrap sm:gap-y-2 sm:overflow-visible sm:pb-0">
      {stats.map((s) => (
        <div key={s.label} className="flex shrink-0 flex-col whitespace-nowrap">
          <span className="text-[10.5px] uppercase tracking-wider text-faint">
            {s.label}
          </span>
          {/* Saat nilai berubah (mis. lewat Realtime) angka lama naik keluar,
              angka baru naik masuk. `initial={false}` = render awal tanpa animasi. */}
          <span className="relative flex overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={s.value}
                initial={{ y: "70%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: "-70%", opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className={cn(
                  "font-mono text-[15px] tabular-nums",
                  s.gold ? "text-gold" : s.crit ? "text-crit" : "text-text"
                )}
              >
                {s.value}
              </motion.span>
            </AnimatePresence>
          </span>
        </div>
      ))}
    </div>
  );
}
