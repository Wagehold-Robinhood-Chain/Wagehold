import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

// Dipakai di Server Component / Route Handler (app/api/*).
// Next.js 16: cookies() sekarang async, jadi createClient() juga async.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Dipanggil dari Server Component -- boleh diabaikan kalau
            // middleware sudah menangani refresh sesi.
          }
        },
      },
    }
  );
}

// Untuk operasi privileged (mis. proses payout dari job) yang perlu
// melewati Row Level Security. JANGAN pernah expose service role key
// ke browser -- hanya dipakai di Route Handler / server action.
export function createServiceRoleClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    }
  );
}
