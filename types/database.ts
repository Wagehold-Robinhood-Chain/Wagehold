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

/** Hasil record_wage_split() (0013_stakes_furnace_bond.sql). */
export interface WageSplitResult {
  gross: number;
  patrons: number;
  lampOil: number;
  tithe: number;
  furnace: number;
  distributed: number;
  treasuryRedirect: number;
  stakerCount: number;
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
      stakes: {
        Relationships: [];
        Row: {
          id: string;
          /** `sim:<hash>` (simulasi) atau alamat wallet lowercase -- sama dengan jobs.client_id. */
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
          /** Bagian patron yang tidak terbagi ke staker -> treasury. */
          treasury_redirect: number;
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
      stake_wage: {
        Args: { p_staker: string; p_agent: string; p_amount: number };
        Returns: number;
      };
      unstake_wage: {
        Args: { p_staker: string; p_agent: string; p_amount: number };
        Returns: number;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
