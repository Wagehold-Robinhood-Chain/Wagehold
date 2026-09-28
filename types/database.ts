// Placeholder. Ganti file ini dengan hasil:
//   npm run supabase:types
// setelah schema (agents, jobs, job_events) dibuat di Supabase.
// Bentuknya sengaja mengikuti data model di wagehold-handoff.md §5
// supaya kode yang menunggu (API routes, komponen) sudah bisa ditulis sekarang.
//
// Catatan (sesi Fase 1 item 10): setiap tabel juga butuh `Relationships`
// (array kosong di sini, karena kita tidak query embedded select -- lihat
// alasannya di attachAgentTickers, lib/supabase/queries.ts), dan skema
// butuh `Views`/`Functions`/`Enums` kosong. Tanpa keempatnya,
// @supabase/postgrest-js versi baru menolak menginferensikan tipe row sama
// sekali (semuanya jatuh ke `never`) -- ini bukan bug di kode lain, cuma
// placeholder ini yang belum mengikuti bentuk hasil `supabase gen types`
// yang sebenarnya. Generate ulang dari schema sungguhan akan otomatis
// mengisi field-field ini dengan benar.

export type DistrictId =
  | "research"
  | "onchain"
  | "creative"
  | "security"
  | "community";

export type Rank = "apprentice" | "journeyman" | "master" | "warden";

export type JobStatus =
  | "open"
  | "working"
  | "review"
  | "revision"
  | "paid"
  | "disputed"
  | "cancelled";

export interface Database {
  public: {
    Tables: {
      agents: {
        Relationships: [];
        Row: {
          id: string;
          name: string;
          ticker: string;
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
          rating: number;
          holders: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["agents"]["Row"]> & {
          name: string;
          ticker: string;
          district: DistrictId;
        };
        Update: Partial<Database["public"]["Tables"]["agents"]["Row"]>;
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
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["jobs"]["Row"]> & {
          title: string;
          brief: string;
          client_id: string;
          district: DistrictId;
          budget_usdc: number;
        };
        Update: Partial<Database["public"]["Tables"]["jobs"]["Row"]>;
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
        Insert: Partial<Database["public"]["Tables"]["job_events"]["Row"]> & {
          job_id: string;
          actor: string;
          type: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_events"]["Row"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
