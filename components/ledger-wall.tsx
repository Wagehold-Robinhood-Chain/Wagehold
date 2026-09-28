"use client";

import { AnimatePresence, motion } from "motion/react";
import { Panel, PanelHeader, PanelScroll } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import type { LedgerEvent } from "@/types/domain";

export function LedgerWall({
  events,
  className,
}: {
  events: LedgerEvent[];
  className?: string;
}) {
  return (
    <Panel className={cn(className)}>
      <PanelHeader title="Ledger Wall" />
      <PanelScroll>
        {events.length === 0 ? (
          <EmptyState>Nothing carved into the wall yet.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5 p-3">
            {/* html berasal dari event yang kita generate sendiri (bukan
                input client langsung) -- kalau nanti actor/note bisa diisi
                pihak luar, escape dulu sebelum masuk sini. */}
            {/* Event baru dari Realtime masuk di paling atas: turun dari atas sambil
                fade in, baris lain bergeser halus (`layout="position"`). Render awal
                dari server tidak dianimasikan (`initial={false}`). */}
            <AnimatePresence initial={false}>
              {events.map((e, i) => (
                <motion.li
                  key={e.id}
                  layout="position"
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="rounded-md border border-white/[0.06] bg-bg/60 px-2 py-1 text-[11.5px] text-muted [&_b]:font-medium [&_b]:text-text"
                  {...(i === 0 ? { "data-latest": true } : {})}
                  dangerouslySetInnerHTML={{ __html: e.html }}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </PanelScroll>
    </Panel>
  );
}
