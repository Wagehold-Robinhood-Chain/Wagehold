"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import type { AgentStatus } from "@/types/domain";

const LABEL: Record<AgentStatus, string> = {
  idle: "Idle",
  working: "Working",
  review: "Awaiting seal",
};

export function StatusPill({ status }: { status: AgentStatus }) {
  const reduce = useReducedMotion();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider",
        status === "idle" && "bg-[#2A3050] text-muted",
        status === "working" && "bg-good/15 text-good",
        status === "review" && "bg-warn/20 text-warn"
      )}
    >
      {status !== "idle" && (
        <motion.span
          aria-hidden
          className="size-1.5 rounded-full bg-current"
          animate={reduce ? undefined : { opacity: [1, 0.25, 1] }}
          transition={{ duration: status === "working" ? 1.2 : 2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {LABEL[status]}
    </span>
  );
}
