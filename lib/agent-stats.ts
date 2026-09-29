/**
 * Statistik Wright yang diturunkan dari tabel `jobs` (sumber kebenaran),
 * bukan dari kolom `agents.jobs_sealed` / `agents.revenue_30d` / `agents.rating`
 * yang isinya angka demo dari 0002_seed_agents.sql (mis. Whale Radar = 70
 * sealed job & rating 4.9 padahal belum ada satu pun baris `jobs` berstatus
 * 'paid').
 *
 * Revenue = 70% Patron share dari budget tiap job yang sudah di-seal -- sama
 * persis dengan yang dikreditkan approveJob() di lib/supabase/queries.ts.
 * Tabel `jobs` belum punya kolom paid_at, jadi ini akumulasi semua job
 * 'paid', bukan jendela 30 hari sungguhan.
 *
 * Rating = rata-rata `jobs.rating` (1-5, opsional, diisi client saat
 * Set the seal -- lihat 0007_job_rating.sql) dari job 'paid' yang di-rate.
 * Job 'paid' tanpa rating tidak ikut dihitung. 0 kalau belum ada satupun.
 */
const PATRON_SHARE = 0.7;

/**
 * Fase 3 item 3: rank (apprentice/journeyman/master) sekarang juga
 * diturunkan dari `jobs` sungguhan, bukan lagi kolom `agents.rank` yang
 * diisi angka demo di 0002_seed_agents.sql. `agents.rank` masih ada di
 * schema (dipakai sebagai nilai awal sebelum job pertama disegel, dan
 * tetap sumber untuk Warden -- lihat catatan di bawah) tapi begitu ada
 * data `jobs.status = 'paid'` sungguhan, thresholds di bawah ini yang
 * menentukan chip rank yang tampil, bukan lagi kolom itu.
 *
 * Konsekuensi yang disengaja: begitu Fase 3 ini aktif, deployment baru
 * (belum ada job disegel sama sekali) akan menampilkan SEMUA Wright
 * non-Warden sebagai Apprentice, walau `agents.rank` seed-nya
 * journeyman/master -- sama seperti revenue30d & rating yang sudah lebih
 * dulu dipotong ke 0 sampai ada job sungguhan (lihat deriveAgentStats).
 * Ini konsisten dengan alasan item 3 dibuat: rank yang berarti adalah
 * rank yang dibuktikan lewat kerja sungguhan, bukan angka demo.
 *
 * Thresholds (belum ada di brief manapun -- keputusan implementasi):
 *  - master:     >= 20 sealed job DAN rating rata-rata >= 4.5
 *  - journeyman: >= 5 sealed job (rating tidak disyaratkan -- job awal
 *                sering belum di-rate client, jangan menahan Wright baru
 *                di apprentice cuma karena belum ada yang memberi rating)
 *  - apprentice: selain itu (termasuk 0 sealed job)
 * Warden TIDAK dihitung dari sini -- perannya struktural (satu per Ward,
 * `agents.is_lead`), bukan tingkatan yang dicapai lewat volume kerja, jadi
 * kode pemanggil harus tetap mengecek `isLead` dulu sebelum memakai fungsi
 * ini (persis pola yang sudah ada di komponen: `isLead ? 'Warden' : ...`).
 */
export function deriveRank(
  jobsSealed: number,
  rating: number,
): 'apprentice' | 'journeyman' | 'master' {
  if (jobsSealed >= 20 && rating >= 4.5) return 'master';
  if (jobsSealed >= 5) return 'journeyman';
  return 'apprentice';
}

/** Bobot urutan rank, dari yang paling junior -- dipakai sebagai tie-break
 *  di lib/agents/wright-runtime.ts (Fase 3 item 5) waktu Warden memilih
 *  antara beberapa Wright yang sama-sama idle: yang lebih senior menang. */
export const RANK_WEIGHT: Record<
  'apprentice' | 'journeyman' | 'master',
  number
> = {
  apprentice: 0,
  journeyman: 1,
  master: 2,
};

export function deriveAgentStats(
  jobs: { status: string; budgetUsdc: number; rating?: number | null }[],
): { jobsSealed: number; revenue30d: number; rating: number } {
  let jobsSealed = 0;
  let revenue = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  for (const j of jobs) {
    if (j.status !== 'paid') continue;
    jobsSealed += 1;
    revenue += Math.round(j.budgetUsdc * PATRON_SHARE * 100) / 100;
    if (j.rating != null) {
      ratingSum += j.rating;
      ratingCount += 1;
    }
  }
  return {
    jobsSealed,
    revenue30d: Math.round(revenue * 100) / 100,
    rating:
      ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0,
  };
}

/**
 * Statistik satu Ward, dipakai untuk profil Warden.
 *
 * Warden (`agents.is_lead`) memang tidak pernah dipilih selectWright() --
 * perannya cuma membagi kerja ke Wright di Ward-nya -- jadi tidak akan ada
 * baris `jobs` dengan agent_id = Warden, dan deriveAgentStats() atas job
 * miliknya sendiri selalu 0/0/0. Angka Warden karena itu diwakili oleh
 * seluruh Ward: pass semua job di district yang sama (dari semua Wright di
 * bawahnya).
 *
 *  - jobsSealed = total job 'paid' seluruh Ward
 *  - revenue30d = total 70% Patron share seluruh Ward
 *  - rating     = rata-rata gabungan semua job ber-rating di Ward itu
 *                 (bobot per job, bukan rata-rata dari rata-rata Wright --
 *                 Wright dengan 30 job tidak boleh sama beratnya dengan yang
 *                 baru 1 job)
 *
 * Job tanpa agent_id (masih 'open') tidak dihitung -- toh belum 'paid'.
 * Tanpa filter district di sini: pemanggil yang memastikan job yang
 * dioper memang milik satu Ward.
 */
export function deriveWardStats(
  wardJobs: {
    status: string;
    budgetUsdc: number;
    rating?: number | null;
    agentId?: string | null;
  }[],
): { jobsSealed: number; revenue30d: number; rating: number } {
  return deriveAgentStats(wardJobs.filter((j) => j.agentId != null));
}
