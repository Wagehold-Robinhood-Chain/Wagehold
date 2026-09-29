'use client';

import { WAGE_SYMBOL } from '@/lib/currency';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useAccount } from 'wagmi';
import { ConnectWalletLink } from '@/components/wallet-connect';
import { PostJobForm, type PostJobValues } from '@/components/post-job-form';
import { lockWageOnChain } from '@/lib/web3/lock-wage';
import { isOnChainEscrowConfigured } from '@/lib/web3/strongbox';
import { SUPPORTED_CHAIN_IDS } from '@/lib/web3/chains';
import type { DistrictId } from '@/types/domain';

/** Wage yang sudah terkunci on-chain dari percobaan submit sebelumnya yang
 *  gagal di langkah simpan-ke-database (mis. Supabase sempat error). Dipakai
 *  lagi kalau nominalnya masih sama, supaya submit ulang tidak mengunci wage
 *  dua kali untuk job yang (dari sudut pandang client) sama. */
interface PendingLock {
  id: string;
  escrowTx: string;
  budgetUsdc: number;
}

/** Membungkus PostJobForm (murni presentational) dengan pemanggilan
 *  POST /api/jobs, dan -- kalau escrow on-chain sudah dikonfigurasi
 *  (Fase 2 item 6) -- mengunci wage sungguhan di WageholdStrongbox lebih
 *  dulu lewat lib/web3/lock-wage.ts sebelum baris job pernah ditulis. Kalau
 *  belum dikonfigurasi, jatuh ke alur simulasi: tanpa login dan tanpa wallet --
 *  job otomatis jadi milik browser ini (cookie `wh_sim`, lib/identity/sim-id.ts). */
export function PostJobClient({
  initialDistrict,
}: {
  initialDistrict?: DistrictId;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [submittingLabel, setSubmittingLabel] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [needsWallet, setNeedsWallet] = useState(false);
  const [pendingLock, setPendingLock] = useState<PendingLock | null>(null);

  // wagmi (bukan hook AppKit) supaya form ini tidak crash di mode simulasi kalau
  // AppKit belum diinisialisasi (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID kosong).
  const { address, isConnected, chainId } = useAccount();

  async function handleSubmit(values: PostJobValues) {
    setSubmitting(true);
    setError(null);
    setNeedsWallet(false);

    let id: string | undefined;
    let escrowTx: string | undefined;

    if (isOnChainEscrowConfigured) {
      if (pendingLock && pendingLock.budgetUsdc === values.budgetUsdc) {
        ({ id, escrowTx } = pendingLock);
      } else {
        if (!isConnected || !address) {
          setError('Connect your wallet first to lock the wage on-chain.');
          setNeedsWallet(true);
          setSubmitting(false);
          return;
        }
        if (typeof chainId === 'number' && !SUPPORTED_CHAIN_IDS.has(chainId)) {
          setError(
            'Switch your wallet to Robinhood Chain first, then post the job again.',
          );
          setSubmitting(false);
          return;
        }

        try {
          id = crypto.randomUUID();
          setSubmittingLabel(`Approving ${WAGE_SYMBOL}…`);
          const result = await lockWageOnChain(id, values.budgetUsdc);
          escrowTx = result.txHash;
          setPendingLock({ id, escrowTx, budgetUsdc: values.budgetUsdc });
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : 'Locking the wage on-chain failed',
          );
          setSubmitting(false);
          setSubmittingLabel(undefined);
          return;
        }
      }
    }

    setSubmittingLabel('Saving job…');

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, ...(id ? { id, escrowTx } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong');

      setPendingLock(null);
      // Agent mengerjakan di background -- arahkan client ke halaman job
      // supaya langsung melihat progres kerjanya (live), bukan menunggu
      // sampai siap di-seal.
      router.push(data.job?.id ? `/jobs/${data.job.id}` : '/jobs');
    } catch (err) {
      const base = err instanceof Error ? err.message : 'Something went wrong';
      setError(
        escrowTx
          ? `Wage already locked on-chain (tx ${escrowTx.slice(0, 10)}…) but saving the job record failed: ${base}. Submit with the same wage amount to retry saving -- it won't lock the wage a second time.`
          : base,
      );
      setSubmitting(false);
      setSubmittingLabel(undefined);
    }
  }

  return (
    <div className="flex flex-col">
      <PostJobForm
        onSubmit={handleSubmit}
        submitting={submitting}
        submittingLabel={submittingLabel}
        initialDistrict={initialDistrict}
      />
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-line px-3.5 py-2 text-[12.5px] text-crit"
          >
            {error}
            {needsWallet && (
              <span className="block text-faint">
                <ConnectWalletLink /> first, then post the job again.
              </span>
            )}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
