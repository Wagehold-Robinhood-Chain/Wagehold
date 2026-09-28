import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted",
        className
      )}
    >
      {children}
    </span>
  );
}
