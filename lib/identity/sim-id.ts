/**
 * Identitas browser untuk MODE SIMULASI (tanpa login, tanpa wallet).
 *
 * proxy.ts memberi tiap browser cookie httpOnly `wh_sim` berisi UUID acak
 * (rahasia, tidak terbaca JavaScript). Yang disimpan di `jobs.client_id` dan
 * terlihat publik hanyalah hash-nya (`sim:<sha256>`), jadi melihat client_id
 * sebuah job tidak cukup untuk mengaku sebagai pemiliknya -- harus pegang
 * cookie aslinya. Hapus cookie / pindah browser = kehilangan akses seal job lama.
 *
 * File ini bebas import server-only supaya bisa dipakai di proxy.ts.
 */
export const SIM_COOKIE = "wh_sim";
export const SIM_ID_PREFIX = "sim:";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSimSecret(value: string | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

export function isSimClientId(clientId: string): boolean {
  return clientId.startsWith(SIM_ID_PREFIX);
}

/** `sim:<32 hex>` -- turunan satu arah dari cookie rahasia. */
export async function simPublicId(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${SIM_ID_PREFIX}${hex.slice(0, 32)}`;
}
