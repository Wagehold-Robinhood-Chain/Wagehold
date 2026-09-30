/**
 * Bantuan untuk kelanjutan sebuah job setelah Wright menyerahkan hasil kerja:
 *  - membaca bagian "Open questions" dari deliverable (dibuat Wright, lihat
 *    system prompt di migrasi 0003 dan 0008),
 *  - mengisi awal catatan "Send back" dari pertanyaan-pertanyaan itu,
 *  - membuat draft brief untuk job baru di Ward lain ("Continue in another
 *    Ward"), yang dititipkan lewat sessionStorage ke halaman /jobs/new.
 *
 * Murni fungsi teks + sessionStorage -- aman dipakai di client.
 */

/** Batas dari API (app/api/jobs/route.ts dan app/api/jobs/[id]/revise/route.ts). */
export const MAX_BRIEF_LENGTH = 4000;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_TITLE_LENGTH = 120;

const OPEN_QUESTIONS_HEADING =
  /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:\d+[.)]\s*)?open\s+questions?\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;
const ANY_HEADING =
  /^\s*(?:#{1,6}\s+\S|(?:\*\*|__)[^*_]{2,80}(?:\*\*|__):?\s*$|-{3,}\s*$)/;

/** Teks di bawah heading "Open questions" (heading terakhir yang cocok), atau
 *  null kalau Wright tidak menuliskannya. Berhenti di heading berikutnya. */
export function extractOpenQuestions(
  deliverable: string | null | undefined,
): string | null {
  if (!deliverable) return null;
  const lines = deliverable.replace(/\r\n/g, '\n').split('\n');

  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (OPEN_QUESTIONS_HEADING.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (ANY_HEADING.test(lines[i])) break;
    body.push(lines[i]);
  }
  const text = body.join('\n').trim();
  return text || null;
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pertanyaan satu per satu (bullet / bernomor; kalau tidak ada bullet, satu
 *  baris = satu pertanyaan, baris lanjutan digabung ke pertanyaan sebelumnya). */
export function parseOpenQuestions(
  deliverable: string | null | undefined,
): string[] {
  const text = extractOpenQuestions(deliverable);
  if (!text) return [];

  const items: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) items.push(stripMarkdown(m[1]));
    else if (items.length > 0 && /^\s/.test(raw)) {
      items[items.length - 1] += ' ' + stripMarkdown(line);
    } else items.push(stripMarkdown(line));
  }
  return items.filter(Boolean);
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/** Isi awal kotak "Send back": tiap pertanyaan diikuti baris jawaban kosong.
 *  Dijaga di bawah MAX_NOTE_LENGTH supaya tidak ditolak API. */
export function buildAnswerTemplate(
  deliverable: string | null | undefined,
): string {
  const questions = parseOpenQuestions(deliverable);
  if (questions.length === 0) return '';

  const blocks: string[] = [];
  let used = 0;
  for (const q of questions) {
    const block = `Q: ${clip(q, 220)}\nA: `;
    // +2 untuk pemisah antar blok; sisakan ~120 karakter untuk jawaban.
    if (used + block.length + 2 + 120 > MAX_NOTE_LENGTH) break;
    blocks.push(block);
    used += block.length + 2;
  }
  return blocks.join('\n\n');
}

/* ------------------------------------------------------------------ */
/* Continue in another Ward                                            */
/* ------------------------------------------------------------------ */

export interface ContinueDraft {
  title: string;
  brief: string;
  /** Teks untuk banner di form: `"judul" (Research Ward · DIVE)`. */
  fromLabel: string;
}

const DRAFT_KEY = 'wagehold:continue-draft';

export function buildContinueDraft(input: {
  title: string;
  wardLabel: string;
  agentCode?: string;
  deliverable: string;
}): ContinueDraft {
  const source = `${input.wardLabel}${input.agentCode ? ` · ${input.agentCode}` : ''}`;
  const intro = `Follow-up to my earlier job "${input.title}" (${source}).`;
  const ask = 'What I want next:\n';
  const openQ = extractOpenQuestions(input.deliverable);
  const openBlock = openQ
    ? `Open questions from that report:\n${clip(openQ, 1200)}`
    : null;
  const reportLabel = 'Earlier report (for context):\n';

  const fixed = [intro, ask, openBlock, reportLabel].filter(
    (p): p is string => p !== null,
  );
  // Sisa ruang (setelah pemisah "\n\n" antar bagian) dipakai untuk isi report.
  const room = MAX_BRIEF_LENGTH - fixed.join('\n\n').length - 2;
  const report = clip(input.deliverable.trim(), Math.max(200, room));

  const brief = clip(
    [intro, ask, openBlock, reportLabel + report]
      .filter((p): p is string => p !== null)
      .join('\n\n'),
    MAX_BRIEF_LENGTH,
  );

  return {
    title: clip(`Follow-up: ${input.title}`, MAX_TITLE_LENGTH),
    brief,
    fromLabel: `"${input.title}" (${source})`,
  };
}

export function saveContinueDraft(draft: ContinueDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage diblokir -- form baru akan terbuka kosong, tidak fatal.
  }
}

/** Baca lalu hapus (sekali pakai). */
export function takeContinueDraft(): ContinueDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DRAFT_KEY);
    const d = JSON.parse(raw) as Partial<ContinueDraft>;
    if (typeof d.title !== 'string' || typeof d.brief !== 'string') return null;
    return {
      title: d.title,
      brief: d.brief,
      fromLabel: String(d.fromLabel ?? ''),
    };
  } catch {
    return null;
  }
}
