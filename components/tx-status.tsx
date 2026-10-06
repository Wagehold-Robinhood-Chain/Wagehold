"use client";

import type { Hash } from "viem";
import { explorerTx } from "@/lib/web3/addresses";
import type { PatronageAction, TxState } from "@/lib/web3/use-patronage";

const DONE_LABEL: Record<PatronageAction, string> = {
  stake: "Staked.",
  requestUnstake: "Unstake requested. Your $WAGE is cooling down.",
  withdraw: "Withdrawn to your wallet.",
  claim: "Patron rewards claimed.",
  claimMany: "Patron rewards claimed from every building.",
};

function TxLink({ hash }: { hash: Hash }) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-1.5 underline decoration-dotted underline-offset-2 hover:text-text"
    >
      View transaction ↗
    </a>
  );
}

/**
 * Status transaksi satu baris di bawah tombol aksi (Dev Brief §8.2). Dipakai panel profil
 * bangunan sekarang, dan halaman /patronage (4B) untuk "Claim all".
 * `role="status"` supaya pembaca layar ikut membacakan perubahan.
 */
export function TxStatus({ tx, onDismiss }: { tx: TxState; onDismiss?: () => void }) {
  if (tx.phase === "idle") return null;

  if (tx.phase === "signing" || tx.phase === "confirming") {
    const multi = tx.step.total > 1 ? ` (step ${tx.step.index} of ${tx.step.total}: ${tx.step.label})` : "";
    return (
      <p role="status" className="text-[11.5px] text-muted">
        {tx.phase === "signing" ? `Confirm in your wallet…${multi}` : `Waiting for confirmation…${multi}`}
        {tx.hash && <TxLink hash={tx.hash} />}
      </p>
    );
  }

  const dismiss = onDismiss && (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss"
      className="ml-2 text-faint hover:text-text"
    >
      ×
    </button>
  );

  if (tx.phase === "done") {
    return (
      <p role="status" className="text-[11.5px] text-good">
        {DONE_LABEL[tx.action]}
        <TxLink hash={tx.hash} />
        {dismiss}
      </p>
    );
  }

  // Sisa union hanya "error". Dicek eksplisit karena TypeScript tidak menyempitkan anggota union
  // yang diskriminannya sendiri berupa union ("signing" | "confirming") lewat dua cek `||` di atas.
  if (tx.phase !== "error") return null;

  return (
    <p role="alert" className="text-[11.5px] text-crit">
      {tx.message}
      {tx.hash && <TxLink hash={tx.hash} />}
      {dismiss}
    </p>
  );
}
