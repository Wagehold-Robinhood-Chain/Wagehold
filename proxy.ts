import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 mengganti nama middleware.ts -> proxy.ts (fungsi: proxy,
// bukan middleware). Perilaku sama persis, hanya nama yang berubah.
//
// PENTING (CVE-2025-29927): proxy/middleware TIDAK boleh jadi satu-satunya
// lapis auth -- request bisa melewatinya lewat manipulasi header tertentu.
// Fungsi ini HANYA me-refresh sesi (supaya token expired diperbarui sebelum
// Server Component / Route Handler membacanya). Setiap Route Handler yang
// butuh user login (POST /api/jobs, approve, revise) tetap WAJIB memanggil
// supabase.auth.getUser() sendiri sebelum memproses -- lihat lib/supabase/queries.ts.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
