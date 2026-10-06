"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/", label: "The City" },
  { href: "/jobs", label: "Job Board" },
  { href: "/patronage", label: "Patronage" },
  { href: "/weighhouse", label: "Weighhouse" },
];

/** Nav kecil di header -- dipakai di Page A (City Dashboard) dan Page B
 *  (Job Board) supaya keduanya bisa saling dituju. Client Component karena
 *  butuh usePathname() untuk menandai tab yang aktif. Pill aktif memakai
 *  `layoutId` -- akan meluncur antar tab kalau header ini suatu saat
 *  dipindah ke layout.tsx (sekarang tiap page merender header-nya sendiri,
 *  jadi pill langsung muncul di tab aktif). */
export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <motion.div key={l.href} whileTap={{ scale: 0.95 }} className="relative">
            <Link
              href={l.href}
              className={cn(
                "relative z-10 block rounded-full px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-text",
                active && "text-text"
              )}
            >
              {l.label}
            </Link>
            {active && (
              <motion.span
                layoutId="site-nav-pill"
                className="absolute inset-0 rounded-full bg-surface-2"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
          </motion.div>
        );
      })}
    </nav>
  );
}
