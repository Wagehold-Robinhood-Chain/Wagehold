import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Ditembak balik oleh Supabase Auth setelah orang login lewat Google/GitHub
// dari LoginForm (signInWithOAuth, redirectTo). PKCE code exchange -- menukar `code` di query
// string dengan sesi sungguhan, lalu set cookie sesi lewat server client
// (lib/supabase/server.ts) sebelum redirect ke halaman tujuan.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Hanya path relatif di situs ini. Tanpa cek ini, `?next=@evil.com` membuat
  // `${origin}${next}` berubah jadi URL ke evil.com (open redirect).
  const rawNext = searchParams.get('next') ?? '/';
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Code hilang, kadaluarsa, atau sudah dipakai -- balik ke /login dengan
  // penanda error supaya orang bisa minta link baru.
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
