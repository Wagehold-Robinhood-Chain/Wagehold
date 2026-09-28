// Tipe buatan tangan yang dipakai lintas aplikasi. Sengaja dipisah dari
// types/database.ts supaya `npm run supabase:types` (yang menimpa seluruh
// database.ts) tidak menghapusnya.

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
