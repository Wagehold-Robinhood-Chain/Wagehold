"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { activeChain } from "@/lib/web3/chains";
import { computeChainAgentId, patronageAbi, patronageAddress } from "@/lib/web3/patronage";
import { useNetworkGate } from "@/lib/web3/use-patronage";
import { patronBuildingIds, sameSet, type StakeRead } from "@/lib/patronage-city";

/**
 * Sesi 4C (Dev Brief §8.3): bangunan mana saja yang di-stake wallet yang terhubung -> cincin emas di kota.
 *
 * Hanya `stakeOf` per bangunan, dibaca langsung dari kontrak (live, bukan indexer). Sengaja BUKAN
 * `useReadContracts`/multicall: definisi chain Robinhood tidak memuat alamat Multicall3 (lihat supply.ts), jadi
 * tiap bangunan satu `readContract` paralel lewat client wagmi, sama seperti jalur server.
 *
 * - Tanpa wallet, atau NEXT_PUBLIC_PATRONAGE_ADDRESS kosong: himpunan kosong, tanpa panggilan RPC.
 * - Bacaan yang gagal mempertahankan status sebelumnya (cincin tidak berkedip karena satu RPC tersendat).
 * - Diperbarui tiap 60 dtk (dilewati saat tab tersembunyi) dan seketika saat tab kembali terlihat.
 * - Membaca lewat `activeChain` walau wallet di chain lain: stake tetap milik wallet itu.
 */
const POLL_MS = 60_000;
const EMPTY: ReadonlySet<string> = new Set();

export function usePatronBuildings(agentIds: readonly string[]): ReadonlySet<string> {
  const { address } = useNetworkGate();
  const client = usePublicClient({ chainId: activeChain.id });
  const [state, setState] = useState<{ wallet: string; ids: ReadonlySet<string> } | null>(null);

  // Kunci string: efek tidak diulang hanya karena identitas array baru dengan isi sama.
  const key = agentIds.join(",");

  useEffect(() => {
    if (!patronageAddress || !address || !client || !key) return;
    const ids = key.split(",");
    let cancelled = false;

    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const settled = await Promise.allSettled(
        ids.map((id) =>
          client.readContract({
            address: patronageAddress,
            abi: patronageAbi,
            functionName: "stakeOf",
            args: [computeChainAgentId(id), address],
          }),
        ),
      );
      if (cancelled) return;
      const reads: StakeRead[] = ids.map((id, i) => {
        const r = settled[i];
        return { agentId: id, staked: r.status === "fulfilled" ? (r.value as bigint) : null };
      });
      setState((prev) => {
        const before = prev && prev.wallet === address ? prev.ids : EMPTY;
        const next = patronBuildingIds(reads, before);
        return prev && prev.wallet === address && sameSet(prev.ids, next) ? prev : { wallet: address, ids: next };
      });
    };

    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [address, client, key]);

  // Wallet diganti / diputus: hasil wallet lama tidak boleh bocor ke wallet baru.
  return state && address && state.wallet === address ? state.ids : EMPTY;
}
