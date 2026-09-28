"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { itemVariants } from "@/components/motion/primitives";

/** Panel ikut animasi stagger kalau berada di dalam <MotionPage>. Di luar itu
 *  (mis. /dev/components) dia tidak beranimasi sama sekali. */
export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={itemVariants}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-panel border border-line bg-surface",
        className
      )}
    >
      {children}
    </motion.div>
  );
}

export function PanelHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3">
      <h2 className="font-display text-[15px] font-semibold text-text">
        {title}
      </h2>
      {action}
    </div>
  );
}

/** Wadah scroll di dalam Panel — dipakai untuk daftar panjang (job list, roster).
 *  `layoutScroll` wajib supaya animasi `layout` anak-anaknya tetap akurat saat
 *  daftar sedang di-scroll (dipakai Ledger Wall). */
export function PanelScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div layoutScroll className={cn("min-h-0 flex-1 overflow-auto", className)}>
      {children}
    </motion.div>
  );
}
