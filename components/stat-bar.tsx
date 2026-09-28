"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

export interface Stat {
  label: string;
  value: string;
  gold?: boolean;
}

export function StatBar({ stats }: { stats: Stat[] }) {
  return (
    <div className="ml-auto flex flex-wrap gap-x-6 gap-y-2">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col">
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
                  s.gold ? "text-gold" : "text-text"
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
