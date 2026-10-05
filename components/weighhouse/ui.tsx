"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Tooltip hover/fokus: rumus angka + tautan Blockscout bila ada (brief §6). */
export function Tip({ children, formula, href, className }: { children: ReactNode; formula: string; href?: string; className?: string }) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      <span tabIndex={0} className="cursor-help underline decoration-dotted decoration-faint underline-offset-4 outline-none">
        {children}
      </span>
      <span role="tooltip" className="invisible absolute left-0 top-full z-30 w-64 pt-1 opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <span className="block rounded-md border border-line bg-surface-2 p-2 text-[11px] font-normal normal-case leading-snug text-muted shadow-lg">
          {formula}
          {href && (
            <a href={href} target="_blank" rel="noreferrer" className="mt-1 block text-gold hover:underline">
              View on Blockscout ↗
            </a>
          )}
        </span>
      </span>
    </span>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warn" | "good" }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px]", tone === "warn" ? "bg-warn/15 text-warn" : tone === "good" ? "bg-good/15 text-good" : "bg-surface-2 text-muted")}>
      {children}
    </span>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="px-3.5 py-6 text-center text-[12.5px] text-faint">{children}</p>;
