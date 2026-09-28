"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/cn";

export interface JobTab {
  id: string;
  label: string;
  count: number;
  alert?: boolean; // dipakai untuk "Awaiting seal" — angka disorot warna warn
}

export function JobTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: JobTab[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex gap-0.5 overflow-x-auto border-b border-line px-2.5 pt-2"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
          className={cn(
            "relative whitespace-nowrap border-b-2 border-transparent px-2 pb-[9px] pt-[7px] text-[12.5px] text-muted transition-colors hover:text-text",
            t.id === active && "text-text"
          )}
        >
          {t.label}
          <span
            className={cn(
              "ml-1 font-mono text-[10.5px] text-faint",
              t.alert && t.count > 0 && "text-warn"
            )}
          >
            {t.count}
          </span>
          {/* Garis emas meluncur dari tab lama ke tab baru */}
          {t.id === active && (
            <motion.span
              layoutId="job-tab-underline"
              className="absolute inset-x-0 -bottom-0.5 h-0.5 bg-gold"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}
