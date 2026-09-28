import type { DistrictId, JobStatus, Rank } from "@/types/database";

export type { DistrictId, JobStatus, Rank };

export type AgentStatus = "idle" | "working" | "review";

export interface AgentSummary {
  id: string;
  name: string;
  ticker: string;
  district: DistrictId;
  rank: Rank;
  isLead: boolean;
  status: AgentStatus;
  revenue30d: number;
}

/** Data lengkap untuk Page E (Wright Profile) -- superset dari AgentSummary
 *  yang dipakai City Dashboard, ditambah field yang cuma dibutuhkan di
 *  halaman profil (description, holders, rating, jobsSealed). */
export interface AgentDetail extends AgentSummary {
  description: string;
  holders: number;
  rating: number;
  jobsSealed: number;
}

export interface JobSummary {
  id: string;
  title: string;
  district: DistrictId;
  agentTicker?: string;
  budgetUsdc: number;
  status: JobStatus;
  progress: number;
  /** Tx hash dari WageholdStrongbox.createJob (Fase 2 item 6) -- null di
   *  job lama / alur simulasi (escrow on-chain belum dikonfigurasi). */
  escrowTx?: string | null;
}

export interface LedgerEvent {
  id: string;
  at: string;
  html: string; // baris pendek, boleh ada <b> mengikuti gaya feed di prototipe
}

export interface RevenueSplitData {
  patronsPct: number; // 70
  lampOilPct: number; // 20
  tithePct: number; // 10
}

export const WARD_LABEL: Record<DistrictId, string> = {
  research: "Research Ward",
  onchain: "Chain Ward",
  creative: "Craft Ward",
  security: "Watch Ward",
  community: "Hearth Ward",
};

/** Urutan ring di City Dashboard -- sama dengan urutan DISTRICTS di
 *  wagehold-prototype.html supaya tata letak kota tidak berubah. */
export const DISTRICT_ORDER: DistrictId[] = [
  "research",
  "onchain",
  "creative",
  "security",
  "community",
];

/** Sama persis dengan token --color-ward-* di app/globals.css. Three.js
 *  butuh nilai hex mentah (tidak bisa baca variabel CSS/kelas Tailwind),
 *  jadi nilainya diduplikasi di sini secara sengaja -- kalau warna Ward
 *  berubah di globals.css, ubah juga di sini. */
export const WARD_COLOR_HEX: Record<DistrictId, string> = {
  research: "#5FB3B0",
  onchain: "#E0A458",
  creative: "#D9776B",
  security: "#9C8BE0",
  community: "#8DBF7F",
};

export const RANK_LABEL: Record<Rank, string> = {
  apprentice: "Apprentice",
  journeyman: "Journeyman",
  master: "Master",
  warden: "Warden",
};
