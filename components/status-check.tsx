"use client";

import { useEffect, useState } from "react";
// framer-motion berganti nama jadi "motion" (paket sama, dipertahankan
// oleh tim yang sama). Import dari "motion/react" untuk React.
import { motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { isWeb3Configured } from "@/lib/web3/config";
import { isOnChainEscrowConfigured } from "@/lib/web3/strongbox";

// NEXT_PUBLIC_* ditanam saat build, jadi nilainya konstan: cukup dihitung sekali, tidak perlu effect + setState.
const hasSupabaseEnv =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Check = {
  label: string;
  status: "ok" | "checking" | "fail";
  detail?: string;
};

export function StatusCheck() {
  const [checks, setChecks] = useState<Check[]>([
    { label: "Tailwind", status: "ok" },
    { label: "Framer Motion", status: "ok" },
    {
      label: "Supabase env",
      status: hasSupabaseEnv ? "ok" : "fail",
      detail: hasSupabaseEnv ? undefined : "isi .env.local dari .env.local.example",
    },
    {
      label: "Supabase connection",
      status: hasSupabaseEnv ? "checking" : "fail",
      detail: hasSupabaseEnv ? undefined : "dilewati, env belum diisi",
    },
    {
      label: "Wallet connect env",
      status: isWeb3Configured ? "ok" : "fail",
      detail: isWeb3Configured
        ? undefined
        : "isi NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID di .env.local",
    },
    {
      // Fase 2 item 6 -- "fail" di sini cuma berarti Post a Job masih
      // memakai alur simulasi lama (Strongbox belum di-deploy / belum
      // disalin ke .env.local), bukan sesuatu yang rusak.
      label: "On-chain escrow env",
      status: isOnChainEscrowConfigured ? "ok" : "fail",
      detail: isOnChainEscrowConfigured
        ? undefined
        : "isi NEXT_PUBLIC_STRONGBOX_ADDRESS / NEXT_PUBLIC_WAGE_TOKEN_ADDRESS -- sementara jatuh ke simulasi",
    },
  ]);

  useEffect(() => {
    if (!hasSupabaseEnv) return;

    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ error }) => {
        setChecks((prev) =>
          prev.map((c) =>
            c.label === "Supabase connection"
              ? {
                  ...c,
                  status: error ? "fail" : "ok",
                  detail: error?.message,
                }
              : c
          )
        );
      })
      .catch((err) => {
        setChecks((prev) =>
          prev.map((c) =>
            c.label === "Supabase connection"
              ? { ...c, status: "fail", detail: String(err) }
              : c
          )
        );
      });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex max-w-md flex-col gap-2 rounded-panel border border-line bg-surface p-4"
    >
      <h2 className="font-display text-sm font-semibold text-text">
        Setup check
      </h2>
      <ul className="flex flex-col gap-2">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">{c.label}</span>
            <span
              className={
                "font-mono text-xs " +
                (c.status === "ok"
                  ? "text-good"
                  : c.status === "fail"
                  ? "text-crit"
                  : "text-warn")
              }
            >
              {c.status === "checking"
                ? "…"
                : c.status === "ok"
                ? "ok"
                : c.detail ?? "gagal"}
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
