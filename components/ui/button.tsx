"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/cn";

interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: "default" | "primary";
  size?: "default" | "small";
}

export function Button({
  variant = "default",
  size = "default",
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "rounded-[7px] border font-medium transition-colors",
        variant === "default" &&
          "border-line bg-surface-2 text-text hover:border-[#46507a]",
        variant === "primary" &&
          "border-gold bg-gold font-semibold text-gold-ink hover:brightness-[1.06]",
        size === "default" && "px-3 py-1.5 text-[13px]",
        size === "small" && "px-2.5 py-1 text-xs",
        className
      )}
      {...props}
    />
  );
}
