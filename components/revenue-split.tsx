"use client";

import { motion } from "motion/react";
import type { RevenueSplitData } from "@/types/domain";

const ROWS: { key: keyof RevenueSplitData; label: string; color: string }[] = [
  { key: "patronsPct", label: "Patrons", color: "bg-gold" },
  { key: "lampOilPct", label: "Lamp Oil", color: "bg-[#6C7392]" },
  { key: "tithePct", label: "Tithe", color: "bg-good" },
  { key: "furnacePct", label: "Furnace", color: "bg-crit" },
];

export function RevenueSplit({ data }: { data: RevenueSplitData }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2.5 overflow-hidden rounded-[3px]">
        {ROWS.map((r, i) => (
          // Tiap segmen tumbuh dari 0 ke persentasenya, berurutan kiri -> kanan.
          <motion.span
            key={r.key}
            className={r.color}
            initial={{ width: 0 }}
            animate={{ width: `${data[r.key]}%` }}
            transition={{ duration: 0.7, ease: "easeOut", delay: 0.35 + i * 0.12 }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted">
        {ROWS.map((r) => (
          <span key={r.key}>
            {r.label} {data[r.key]}%
          </span>
        ))}
      </div>
    </div>
  );
}
