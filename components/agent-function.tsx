import { WARD_COLOR_HEX } from '@/types/domain';
import type { DistrictId } from '@/types/domain';

/** Fungsi/tugas agen ditampilkan sebagai callout: garis kiri + tint dengan warna
 *  Ward-nya, label kecil "What it does", dan teks lebih besar & terang supaya
 *  langsung terbaca dibanding chip/statistik di sekitarnya. */
export function AgentFunction({
  description,
  district,
}: {
  description: string;
  district: DistrictId;
}) {
  const color = WARD_COLOR_HEX[district];
  return (
    <div
      className="rounded-r-[8px] border-l-[3px] py-2 pl-3 pr-3"
      style={{
        borderLeftColor: color,
        background: `linear-gradient(90deg, ${color}26, ${color}0d)`,
      }}
    >
      <span
        className="text-[10.5px] font-semibold uppercase tracking-wider"
        style={{ color }}
      >
        What it does
      </span>
      <p className="mt-0.5 text-[15px] font-medium leading-snug text-text">
        {description}
      </p>
    </div>
  );
}
