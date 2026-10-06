import type { Metadata } from "next";
import { PatronageClient, type ContractLink } from "@/components/patronage/patronage-client";
import { getIndexedBlock, getPools, type PoolView } from "@/lib/patronage-onchain";
import { PATRONAGE } from "@/lib/web3/addresses";
import { patronageAddress } from "@/lib/web3/patronage";

export const metadata: Metadata = {
  title: "The Patrons' Hall · Wagehold",
  description:
    "Stake $WAGE on the buildings you back and share their patron cut of every sealed wage. Every figure links back to the chain.",
};

// Daftar pool dibaca dari tabel turunan indexer (tanpa RPC di jalur request). Segarkan tiap 30 dtk.
export const revalidate = 30;

export default async function PatronagePage() {
  // Alamat untuk browser (NEXT_PUBLIC_*) dan untuk indexer server (WEIGHHOUSE_*) adalah dua variabel
  // terpisah yang HARUS sama. Kalau beda, tabel menampilkan kontrak yang tidak dipakai transaksi user.
  if (patronageAddress && PATRONAGE.patronage && patronageAddress.toLowerCase() !== PATRONAGE.patronage.toLowerCase()) {
    console.warn(
      `[patronage] NEXT_PUBLIC_PATRONAGE_ADDRESS (${patronageAddress}) != WEIGHHOUSE_PATRONAGE_ADDRESS (${PATRONAGE.patronage}): the table and the wallet actions point at different contracts.`,
    );
  }

  let pools: PoolView[] = [];
  let indexedBlock: number | null = null;
  let failed = false;

  // Indexer mati (WEIGHHOUSE_PATRONAGE_ADDRESS kosong) bukan galat: tabel kosong dengan pesan.
  // Hanya pembacaan yang benar-benar gagal (migrasi 0018 belum jalan, Supabase down) yang ditandai.
  if (PATRONAGE.patronage) {
    try {
      [pools, indexedBlock] = await Promise.all([getPools("staked"), getIndexedBlock()]);
    } catch (e) {
      failed = true;
      console.error("[patronage page]", e);
    }
  }

  // Alamat Patronage yang ditampilkan = yang dipanggil wallet user. Token $WAGE tidak ditampilkan di sini:
  // alamat yang benar dibaca dari kontrak Patronage (`wageToken()`), bukan konstanta mainnet.
  const candidates: { label: string; address: string | undefined }[] = [
    { label: "Patronage", address: patronageAddress ?? PATRONAGE.patronage },
    { label: "Splitter v2", address: PATRONAGE.splitterV2 },
    { label: "Strongbox v2", address: PATRONAGE.strongboxV2 },
  ];
  const contracts: ContractLink[] = candidates.flatMap((c) => (c.address ? [{ label: c.label, address: c.address }] : []));

  return (
    <PatronageClient
      initialPools={pools}
      initialIndexedBlock={indexedBlock}
      initialFailed={failed}
      live={!!(patronageAddress ?? PATRONAGE.patronage)}
      contracts={contracts}
    />
  );
}
