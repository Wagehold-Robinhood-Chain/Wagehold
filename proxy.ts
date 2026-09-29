import { NextResponse, type NextRequest } from "next/server";
import { SIM_COOKIE, isValidSimSecret } from "@/lib/identity/sim-id";

// Next.js 16 mengganti nama middleware.ts -> proxy.ts (fungsi: proxy).
//
// Tidak ada login lagi. Satu-satunya tugas proxy ini: memastikan setiap browser
// punya cookie httpOnly `wh_sim` (UUID acak) -- identitas browser untuk MODE
// SIMULASI (lihat lib/identity/sim-id.ts). Cookie juga dimasukkan ke request yang
// sedang berjalan supaya Server Component / Route Handler di request pertama
// sudah bisa membacanya.
//
// PENTING (CVE-2025-29927): proxy TIDAK boleh jadi lapis otorisasi. Kepemilikan
// job dicek ulang di tiap Route Handler lewat lib/identity/server.ts.
export function proxy(request: NextRequest) {
  if (isValidSimSecret(request.cookies.get(SIM_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const secret = crypto.randomUUID();
  request.cookies.set(SIM_COOKIE, secret);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(SIM_COOKIE, secret, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365 * 2,
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
