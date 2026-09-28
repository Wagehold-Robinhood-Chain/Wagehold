"use client";

import { motion } from "motion/react";

export function EmptyState({ children }: { children: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="px-3.5 py-7 text-center text-[13px] text-faint"
    >
      {children}
    </motion.div>
  );
}
