'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { ConnectWalletLink } from '@/components/wallet-connect';

export type EmptyKind = 'review' | 'working' | 'open' | 'paid' | 'wallet';

/** Ikon garis sederhana (currentColor) -- tanpa dependensi tambahan. */
const ICONS: Record<EmptyKind, ReactNode> = {
  // stempel / seal
  review: (
    <>
      <path d="M9 3h6l1 6H8l1-6Z" />
      <path d="M6 14a6 6 0 0 1 12 0v1H6v-1Z" />
      <path d="M5 21h14" />
    </>
  ),
  // jam pasir
  working: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9" />
    </>
  ),
  // kotak masuk
  open: (
    <>
      <path d="M3 13l3-8h12l3 8" />
      <path d="M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6h-5a4 4 0 0 1-8 0H3Z" />
    </>
  ),
  // lencana centang
  paid: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 3 3 5-6" />
    </>
  ),
  // dompet
  wallet: (
    <>
      <path d="M4 7a2 2 0 0 1 2-2h12v4" />
      <path d="M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2Z" />
      <circle cx="16.5" cy="14.5" r="1" />
    </>
  ),
};

const COPY: Record<
  EmptyKind,
  { title: string; text: string; cta?: 'post' | 'wallet' }
> = {
  review: {
    title: 'Nothing is waiting for your seal',
    text: 'When a Wright delivers, the work lands here. Read it, rate it, then set the seal to release the wage.',
    cta: 'post',
  },
  working: {
    title: 'The city is quiet',
    text: 'No Wright is at work right now. Post a job and the Warden will send one to the site.',
    cta: 'post',
  },
  open: {
    title: 'The line is empty',
    text: 'No open jobs. Post one to start the line.',
    cta: 'post',
  },
  paid: {
    title: 'No seals yet',
    text: 'Every sealed job in the city shows up here once a client sets the seal.',
  },
  wallet: {
    title: 'Connect your wallet',
    text: 'Your wallet is your account. Connect it to see and manage your own jobs.',
    cta: 'wallet',
  },
};

/** Empty state Job Board: mengisi tinggi panel dan diletakkan di tengah, jadi
 *  tidak ada lagi satu baris teks kecil di puncak kartu yang kosong. */
export function JobBoardEmpty({ kind }: { kind: EmptyKind }) {
  const c = COPY[kind];
  return (
    <div
      className="relative flex min-h-full items-center justify-center overflow-hidden px-6 py-12"
      style={{
        background:
          'radial-gradient(60% 55% at 50% 45%, rgba(230,195,106,0.07), transparent 70%)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="flex max-w-sm flex-col items-center gap-3 text-center"
      >
        <motion.div
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
          className="mb-1 flex size-20 items-center justify-center rounded-full border border-gold/30 bg-gold/[0.08] text-gold shadow-[0_0_40px_rgba(230,195,106,0.12)]"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {ICONS[kind]}
          </svg>
        </motion.div>
        <h3 className="font-display text-lg font-semibold tracking-tight text-text">
          {c.title}
        </h3>
        <p className="text-[13px] leading-relaxed text-muted">{c.text}</p>
        {c.cta === 'post' && (
          <Link href="/jobs/new" className="mt-2">
            <Button variant="primary">Post a job</Button>
          </Link>
        )}
        {c.cta === 'wallet' && (
          <span className="mt-2 text-[13px]">
            <ConnectWalletLink />
          </span>
        )}
      </motion.div>
    </div>
  );
}
