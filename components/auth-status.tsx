"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/** Status login di header -- dipasang di semua 5 page (A-E). Client
 *  Component murni: cek sesi lewat browser client, lalu dengar
 *  `onAuthStateChange` supaya begitu magic link diklik (Page login →
 *  /auth/callback) atau tombol Sign out ditekan, tampilan ini dan semua
 *  Server Component di halaman yang sama (isOwnJob dkk) ikut ter-refresh. */
export function AuthStatus() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  // undefined = belum tahu (baru mount), null = signed out
  const [email, setEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
      router.refresh();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  if (email === undefined) {
    // Placeholder ukuran tetap -- menghindari layout jitter saat sesi dicek.
    return <span className="ml-auto h-[26px] w-16" />;
  }

  if (!email) {
    return (
      <Link
        href="/login"
        className="ml-auto rounded-full px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-text"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      <span className="hidden max-w-[160px] truncate text-[12px] text-muted sm:inline">
        {email}
      </span>
      <Button size="small" onClick={() => supabase.auth.signOut()}>
        Sign out
      </Button>
    </div>
  );
}
