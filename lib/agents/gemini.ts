// Klien tipis untuk Gemini API (REST langsung, tanpa SDK tambahan).
//
// Fase 1 item 10 minta "1 agent Research Ward ke Claude API", tapi dipakai
// dengan AI gratisan -- jadi Deepdive ($DIVE) memanggil Google Gemini
// (tier gratis Google AI Studio) lewat file ini, bukan Anthropic API.
// Kalau nanti mau pindah ke Claude API sungguhan, cukup tulis
// `lib/agents/claude.ts` senada dan tukar importnya di research-wright.ts --
// pemanggil (research-wright.ts) tidak perlu berubah selain nama fungsi.

const DEFAULT_MODEL = "gemini-3.8-flash";
const ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiCallResult {
  text: string;
}

interface GeminiCallOptions {
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

/** Melempar Error kalau API key belum diisi, request timeout, atau Gemini
 *  membalas non-2xx / tanpa teks. Sengaja TIDAK menangkap error di sini --
 *  research-wright.ts yang bertanggung jawab mencatatnya ke Ledger Wall
 *  (Charter IV) dan mengembalikan job ke status aman, bukan meng-crash
 *  Route Handler yang memanggilnya. */
export async function callGemini(
  systemPrompt: string,
  userPrompt: string,
  opts: GeminiCallOptions = {}
): Promise<GeminiCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  // Env var menang atas nilai di database (agents.model), supaya kalau Google
  // menghentikan sebuah model cukup ganti GEMINI_MODEL di Vercel.
  const model = process.env.GEMINI_MODEL?.trim() || opts.model?.trim() || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

  try {
    const res = await fetch(
      `${ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            maxOutputTokens: opts.maxOutputTokens ?? 900,
            temperature: 0.4,
          },
        }),
      }
    );

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`Gemini API returned ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    const data: GeminiResponse = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();

    if (!text) {
      throw new Error(
        `Gemini returned no text (finishReason: ${candidate?.finishReason ?? "unknown"})`
      );
    }

    return { text };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Gemini API timed out after ${opts.timeoutMs ?? 30_000}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Bentuk minimal respons Gemini yang benar-benar kita pakai -- bukan tipe
// resmi dari SDK (kita sengaja tidak menambah dependency untuk satu
// pemanggilan REST ini).
interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
}
