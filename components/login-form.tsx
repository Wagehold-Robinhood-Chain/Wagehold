'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

type Provider = 'google' | 'github';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.2A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.2z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

const PROVIDERS: { id: Provider; label: string; icon: React.ReactNode }[] = [
  { id: 'google', label: 'Continue with Google', icon: <GoogleIcon /> },
  { id: 'github', label: 'Continue with GitHub', icon: <GitHubIcon /> },
];

export function LoginForm() {
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState('');

  async function signIn(provider: Provider) {
    setPending(provider);
    setError('');

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        // Setelah login di Google/GitHub, Supabase mengembalikan orang ke sini
        // dengan `?code=...`; app/auth/callback/route.ts menukarnya jadi sesi
        // (PKCE) dan mengarahkan ke halaman tujuan.
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    // Kalau sukses, browser langsung dialihkan ke provider -- kode di bawah
    // hanya jalan kalau pengalihan gagal (mis. provider belum diaktifkan).
    if (error) {
      setError(error.message);
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3.5">
      <p className="text-[12.5px] text-faint">
        No password. Sign in with an account you already have.
      </p>

      {PROVIDERS.map((p) => (
        <Button
          key={p.id}
          type="button"
          variant={p.id === 'google' ? 'primary' : 'default'}
          disabled={pending !== null}
          onClick={() => signIn(p.id)}
          className="flex items-center justify-center gap-2"
        >
          {p.icon}
          {pending === p.id ? 'Redirecting…' : p.label}
        </Button>
      ))}

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="text-[11.5px] text-crit"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
