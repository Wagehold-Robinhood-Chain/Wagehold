import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

// Dipakai di Client Component, mis. untuk subscribe realtime (Ledger Wall)
// atau memanggil Supabase langsung dari browser.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
