"use client";

import { useAccount } from "wagmi";
import { isWalletMode } from "@/lib/identity/mode";

/**
 * Siapa "saya" di browser ini -- pengganti useCurrentUserId (Supabase Auth).
 *
 * - mode wallet: alamat wallet yang terhubung (lowercase, sama dengan
 *   `jobs.client_id`), atau null kalau belum connect;
 * - mode simulasi: client_id browser dari server (`initialSimId`, hash cookie).
 *
 * Ini hanya menentukan tombol mana yang ditampilkan. Keputusan sesungguhnya tetap
 * dicek server di tiap Route Handler (lib/identity/server.ts).
 */
export function useIdentity(initialSimId: string | null): string | null {
  // useAccount aman dipanggil tanpa syarat: WagmiProvider selalu ada
  // (components/web3-provider.tsx), walau AppKit belum diinisialisasi.
  const { address } = useAccount();
  if (isWalletMode) return address ? address.toLowerCase() : null;
  return initialSimId;
}
