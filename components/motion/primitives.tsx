"use client";

import { MotionConfig, motion, type HTMLMotionProps, type Variants } from "motion/react";
import type { ReactNode } from "react";

/** Easing "ease-out expo" yang dipakai di seluruh app supaya gerakannya seragam. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Container: hanya mengatur stagger anak-anaknya, tidak menganimasikan dirinya sendiri. */
export const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.02 } },
};

/** Elemen konten (Panel, kartu, dll): naik sedikit sambil fade in. */
export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
};

const headerVariants: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_OUT } },
};

const footerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5, ease: "easeOut" } },
};

/** Bungkus seluruh app (dipakai di app/layout.tsx). `reducedMotion="user"` membuat semua
 *  animasi transform/layout otomatis mati kalau OS user mengaktifkan "reduce motion". */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Pengganti <main> di setiap page. Semua anak yang punya `variants` (MotionHeader,
 *  MotionFooter, dan <Panel>) otomatis muncul berurutan (stagger) saat page dibuka. */
export function MotionPage(props: HTMLMotionProps<"main">) {
  return <motion.main variants={containerVariants} initial="hidden" animate="visible" {...props} />;
}

export function MotionHeader(props: HTMLMotionProps<"header">) {
  return <motion.header variants={headerVariants} {...props} />;
}

export function MotionFooter(props: HTMLMotionProps<"footer">) {
  return <motion.footer variants={footerVariants} {...props} />;
}

/** Untuk elemen lain yang ingin ikut stagger page tapi bukan Panel. */
export function MotionItem(props: HTMLMotionProps<"div">) {
  return <motion.div variants={itemVariants} {...props} />;
}
