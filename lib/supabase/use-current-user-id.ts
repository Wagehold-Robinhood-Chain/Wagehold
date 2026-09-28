"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * ID user yang sedang login, disinkronkan lewat `onAuthStateChange` --
 * dipakai komponen realtime (Job Board, Job Detail) untuk menghitung ulang
 * gerbang seal (`isOwnJob`) begitu user sign in/out.
 *
 * Sengaja tidak bergantung pada `router.refresh()` dari `AuthStatus`:
 * refresh itu menarik ulang props awal dari Server Component, tapi state
 * client yang sudah diinisialisasi lewat `useState(initial...)` di
 * komponen realtime tidak otomatis ikut berubah cuma karena prop awal
 * berubah setelah mount pertama. Melacak user id sendiri di sini membuat
 * gerbang seal tetap benar tanpa bergantung pada urutan refresh itu.
 */
export function useCurrentUserId(initialUserId: string | null) {
  const [userId, setUserId] = useState(initialUserId);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) setUserId(data.user?.id ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return userId;
}
