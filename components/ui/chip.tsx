import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ChipProps {
  children: ReactNode;
  variant?: "default" | "rank" | "sigil";
  className?: string;
}

export function Chip({ children, variant = "default", className }: ChipProps) {
  if (variant === "sigil") {
    return (
      <span className={cn("font-mono text-xs text-gold", className)}>
        {children}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
        variant === "default" && "bg-surface-2 text-muted",
        variant === "rank" && "bg-gold/10 text-gold",
        className
      )}
    >
      {children}
    </span>
  );
}
