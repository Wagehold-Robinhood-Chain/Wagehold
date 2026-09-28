"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Diproses oleh app/auth/callback/route.ts (PKCE code exchange),
        // lalu diarahkan balik ke halaman ini datang dari.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="px-3.5 py-4 text-[13px] text-muted"
      >
        Check <span className="text-text">{email}</span> for a sign-in link. The Gate opens
        the moment you click it.
      </motion.p>
    );
  }

  const labelClass = "flex flex-col gap-1 text-[11px] tracking-wide text-muted";
  const inputClass =
    "rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus-visible:border-gold";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3.5">
      <p className="text-[12.5px] text-faint">
        No password -- we email you a one-time sign-in link.
      </p>

      <label className={labelClass}>
        Email
        <input
          type="email"
          required
          autoFocus
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </label>

      <Button type="submit" variant="primary" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Send magic link"}
      </Button>

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
    </form>
  );
}
