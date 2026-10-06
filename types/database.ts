// Placeholder. Ganti file ini dengan hasil:
//   npm run supabase:types
// setelah schema (agents, jobs, job_events) dibuat di Supabase.
// Bentuknya sengaja mengikuti data model di wagehold-handoff.md §5
// supaya kode yang menunggu (API routes, komponen) sudah bisa ditulis sekarang.
//
// Catatan (sesi Fase 1 item 10): setiap tabel juga butuh `Relationships`
// (array kosong di sini, karena kita tidak query embedded select -- lihat
// alasannya di attachAgentCodes, lib/supabase/queries.ts), dan skema
// butuh `Views`/`Functions`/`Enums` kosong. Tanpa keempatnya,
// @supabase/postgrest-js versi baru menolak menginferensikan tipe row sama
// sekali (semuanya jatuh ke `never`) -- ini bukan bug di kode lain, cuma
// placeholder ini yang belum mengikuti bentuk hasil `supabase gen types`
// yang sebenarnya. Generate ulang dari schema sungguhan akan otomatis
// mengisi field-field ini dengan benar.

import type { DistrictId, JobStatus, Rank } from '@/types/enums';

/** Hasil record_wage_split() (ditulis ulang di 0020: tanpa pembagian ke staker simulasi). */
export interface WageSplitResult {
  gross: number;
  patrons: number;
  lampOil: number;
  tithe: number;
  furnace: number;
}

/** Hasil counting_house_totals() (0020). Semua jumlah = string base unit (18 desimal). */
export interface CountingHouseRaw {
  tithe: string;
  redirected: string;
  total: string;
}

/** Hasil patronage_pools() (0018_patronage_onchain.sql). Semua jumlah = string base unit (18 desimal). */
export interface PatronagePoolRaw {
  agent_id: string; chain_agent_id: string; name: string; code: string; district: DistrictId;
  registered: boolean; total_staked: string; patron_count: number;
  rewards_total: string; redirected_total: string;
  sealed_window: string; jobs_window: number; patron_cut_window: string; notified_window: string;
}

/** Hasil patronage_positions_of() (0018). `name`/`agent_id` null = bangunan belum dipetakan (agents.chain_agent_id kosong). */
export interface PatronagePositionRaw {
  chain_agent_id: string; agent_id: string | null; name: string | null; code: string | null; district: DistrictId | null;
  staked: string; cooling: string; unlock_at: string | null; claimed_total: string; updated_block: number;
}

/** Hasil patronage_pool_rewards() (0018). kind: 'shared' = RewardNotified, 'redirected' = RewardRedirected. */
export interface PatronageRewardRaw {
  tx_hash: string; log_index: number; block_number: number; block_time: string;
  kind: 'shared' | 'redirected'; amount: string; chain_job_id: string | null; job_id: string | null;
}

/** Hasil patronage_totals() (0018). */
export interface PatronageTotalsRaw {
  totalStaked: string; rewardsTotal: string; redirectedTotal: string; buildings: number; patrons: number;
}

/** Hasil weighhouse_flow() (0014_weighhouse.sql). Jumlah = string base unit (18 desimal). */
export interface WeighhouseFlowRaw {
  locked: string; sealed: string; refunded: string;
  patrons: string; lampOil: string; tithe: string; furnaceBooked: string; burned: string;
  jobsPosted: number; jobsSealed: number; jobsRefunded: number; jobsDisputed: number;
}

export interface Database {
  public: {
    Tables: {
      agents: {
        Relationships: [];
        Row: {
          id: string;
          name: string;
          code: string;
          district: DistrictId;
          is_lead: boolean;
          rank: Rank;
          description: string;
          wallet: string | null;
          /** keccak256(bytes(id)) -- agentId on-chain (0018). Diisi scripts/patronage-backfill-agent-ids.ts. */
          chain_agent_id?: string | null;
          token_address: string | null;
          system_prompt: string;
          tools: string[];
          model: string;
          revenue_30d: number;
          jobs_sealed: number;
          rating: number | null;
          holders: number;
          /** WAGE yang dikunci bangunan ini, slashed kalau kalah sengketa
           *  (0013_stakes_furnace_bond.sql; nilai awal 1000 = placeholder). */
          bond_wage: number;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['agents']['Row']> & {
          name: string;
          code: string;
          district: DistrictId;
        };
        Update: Partial<Database['public']['Tables']['agents']['Row']>;
      };
      jobs: {
        Relationships: [];
        Row: {
          id: string;
          title: string;
          brief: string;
          client_id: string;
          district: DistrictId;
          agent_id: string | null;
          budget_usdc: number;
          escrow_tx: string | null;
          status: JobStatus;
          progress: number;
          /** Hasil kerja Wright (Research Ward saja untuk sekarang -- Fase 1
           *  item 10). null sampai statusnya 'review'. */
          deliverable: string | null;
          /** Rating 1-5 dari client saat set-the-seal (0007_job_rating.sql).
           *  null kalau belum di-rate (termasuk semua job sebelum 'paid'). */
          rating: number | null;
          /** keccak256(bytes(uuid)) -- jobId on-chain (0014_weighhouse.sql). null = job simulasi. */
          chain_job_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['jobs']['Row']> & {
          title: string;
          brief: string;
          client_id: string;
          district: DistrictId;
          budget_usdc: number;
        };
        Update: Partial<Database['public']['Tables']['jobs']['Row']>;
      };
      /** 0020: satu baris penanda kapan simulasi Patronage dibekukan. */
      patronage_cutover: {
        Relationships: [];
        Row: {
          id: boolean;
          frozen_at: string;
          /** Blok chain saat dibekukan; null sampai diisi manual (PATRONAGE_4D.md). */
          freeze_block: number | null;
          note: string | null;
        };
        Insert: Partial<Database['public']['Tables']['patronage_cutover']['Row']>;
        Update: Partial<Database['public']['Tables']['patronage_cutover']['Row']>;
      };
      /** FROZEN sejak 0020: simulasi, hanya-baca (riwayat). Sumber kebenaran on-chain = patron_positions. */
      stakes: {
        Relationships: [];
        Row: {
          id: string;
          /** `sim:<hash>` (identitas browser simulasi) atau alamat wallet lowercase -- sama dengan jobs.client_id. */
          staker_id: string;
          agent_id: string;
          /** 0 = sudah menarik semua stake (baris dipertahankan untuk riwayat `earned`). */
          amount: number;
          earned: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['stakes']['Row']> & {
          staker_id: string;
          agent_id: string;
        };
        Update: Partial<Database['public']['Tables']['stakes']['Row']>;
      };
      stake_payouts: {
        Relationships: [];
        Row: {
          id: string;
          job_id: string;
          agent_id: string;
          staker_id: string;
          amount: number;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['stake_payouts']['Row']> & {
          job_id: string;
          agent_id: string;
          staker_id: string;
          amount: number;
        };
        Update: Partial<Database['public']['Tables']['stake_payouts']['Row']>;
      };
      wage_splits: {
        Relationships: [];
        Row: {
          job_id: string;
          agent_id: string;
          gross: number;
          patrons: number;
          lamp_oil: number;
          tithe: number;
          furnace: number;
          /** LEGACY (0013): bagian patron simulasi yang tidak terbagi. Selalu 0 sejak 0020. */
          treasury_redirect: number;
          /** LEGACY (0013): jumlah staker simulasi saat seal. Selalu 0 sejak 0020. */
          staker_count: number;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['wage_splits']['Row']> & {
          job_id: string;
          agent_id: string;
          gross: number;
          patrons: number;
          lamp_oil: number;
          tithe: number;
          furnace: number;
        };
        Update: Partial<Database['public']['Tables']['wage_splits']['Row']>;
      };
      chain_events: {
        Relationships: [];
        Row: {
          tx_hash: string;
          log_index: number;
          block_number: number;
          block_time: string;
          contract: string;
          event: string;
          chain_job_id: string | null;
          /** numeric(78,0) -- PostgREST mengirimnya sebagai number/string; pakai BigInt(String(x)). */
          amount: string | number | null;
          args: Record<string, unknown>;
        };
        Insert: Database['public']['Tables']['chain_events']['Row'];
        Update: Partial<Database['public']['Tables']['chain_events']['Row']>;
      };
      patron_positions: {
        Relationships: [];
        Row: {
          agent_id: string; wallet: string;
          /** numeric(78,0): jangan baca langsung (hilang presisi). Pakai patronage_positions_of(). */
          staked: string | number; cooling: string | number; unlock_at: string | null;
          claimed_total: string | number; updated_block: number;
        };
        Insert: Database['public']['Tables']['patron_positions']['Row'];
        Update: Partial<Database['public']['Tables']['patron_positions']['Row']>;
      };
      building_pools: {
        Relationships: [];
        Row: {
          agent_id: string; registered: boolean;
          total_staked: string | number; patron_count: number;
          rewards_total: string | number; redirected_total: string | number; updated_block: number;
        };
        Insert: Database['public']['Tables']['building_pools']['Row'];
        Update: Partial<Database['public']['Tables']['building_pools']['Row']>;
      };
      price_snapshots: {
        Relationships: [];
        Row: {
          taken_at: string;
          price_usd: number | null;
          price_eth: number | null;
          liquidity_usd: number | null;
          volume_wage: string | number | null;
          source: string;
        };
        Insert: Database['public']['Tables']['price_snapshots']['Row'];
        Update: Partial<Database['public']['Tables']['price_snapshots']['Row']>;
      };
      supply_snapshots: {
        Relationships: [];
        Row: {
          taken_at: string;
          block_number: number;
          total: string | number | null;
          burned: string | number | null;
          curve: string | number | null;
          lp: string | number | null;
          locker: string | number | null;
          strongbox: string | number | null;
          splitter: string | number | null;
          /** Saldo kontrak Patronage (0019). null di snapshot lama = 0. */
          patronage: string | number | null;
          treasuries: string | number | null;
          circulating: string | number | null;
        };
        Insert: Database['public']['Tables']['supply_snapshots']['Row'];
        Update: Partial<Database['public']['Tables']['supply_snapshots']['Row']>;
      };
      indexer_state: {
        Relationships: [];
        Row: { key: string; last_block: number };
        Insert: { key: string; last_block: number };
        Update: Partial<{ key: string; last_block: number }>;
      };
      job_events: {
        Relationships: [];
        Row: {
          id: string;
          job_id: string;
          at: string;
          actor: string;
          type: string;
          note: string | null;
          tx: string | null;
        };
        Insert: Partial<Database['public']['Tables']['job_events']['Row']> & {
          job_id: string;
          actor: string;
          type: string;
        };
        Update: Partial<Database['public']['Tables']['job_events']['Row']>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      /** 0020: Counting House dari chain_events (service role). */
      counting_house_totals: {
        Args: Record<string, never>;
        Returns: CountingHouseRaw;
      };
      record_wage_split: {
        Args: {
          p_job_id: string;
          p_patrons_pct: number;
          p_lamp_oil_pct: number;
          p_tithe_pct: number;
          p_furnace_pct: number;
        };
        /** null = job tidak punya Wright, belum 'paid', atau sudah pernah dicatat. */
        Returns: WageSplitResult | null;
      };
      weighhouse_flow: {
        Args: { p_since: string | null };
        Returns: WeighhouseFlowRaw;
      };
      weighhouse_swap_volume: {
        Args: { p_since: string | null };
        Returns: string;
      };
      /** 0015_weighhouse_market.sql -- volume WAGE curve + pool v4 (penyebut Work Ratio). */
      weighhouse_trade_volume: {
        Args: { p_since: string | null };
        Returns: { curve: string; pool: string; trades: number };
      };
      weighhouse_burn_daily: {
        Args: { p_since: string | null };
        Returns: { day: string; burned: string }[];
      };
      /** 0018_patronage_onchain.sql */
      patronage_apply: {
        Args: { p_patronage: string; p_up_to: number };
        /** jumlah event diproses; 0 = tidak ada yang baru; -1 = sedang dikerjakan proses lain. */
        Returns: number;
      };
      patronage_pools: {
        Args: { p_since: string | null };
        Returns: PatronagePoolRaw[];
      };
      patronage_positions_of: {
        Args: { p_wallet: string };
        Returns: PatronagePositionRaw[];
      };
      patronage_pool_rewards: {
        Args: { p_chain_agent_id: string; p_limit: number };
        Returns: PatronageRewardRaw[];
      };
      patronage_totals: {
        Args: Record<string, never>;
        Returns: PatronageTotalsRaw;
      };
      weighhouse_top_buildings: {
        Args: { p_since: string | null; p_limit: number };
        Returns: {
          agent_id: string; name: string; code: string; district: DistrictId;
          /** `staked` = total stake on-chain sekarang, string base unit (0019). */
          sealed: string; jobs: number; staked: string; rating: number | null;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
