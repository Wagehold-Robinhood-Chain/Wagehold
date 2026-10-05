"use client";

import { fmtWage } from "./format";

/** Grafik SVG ringan (tanpa dependensi chart). viewBox tetap, lebar 100% -> aman di 390px. */
const W = 600, H = 180, PAD = { l: 8, r: 8, t: 10, b: 20 };

export function BurnChart({ data }: { data: { day: string; burned: number; cumulative: number }[] }) {
  const maxBar = Math.max(...data.map((d) => d.burned), 1);
  const maxCum = Math.max(...data.map((d) => d.cumulative), 1);
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const bw = Math.max(Math.min(iw / data.length - 4, 40), 3);
  const x = (i: number) => PAD.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * (iw - bw) + bw / 2);
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${(PAD.t + ih - (d.cumulative / maxCum) * ih).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="WAGE burned per day with cumulative line">
      {data.map((d, i) => {
        const h = (d.burned / maxBar) * ih;
        return (
          <g key={d.day}>
            <rect x={x(i) - bw / 2} y={PAD.t + ih - h} width={bw} height={Math.max(h, 1)} rx={2} fill="#E27070" opacity={0.85}>
              <title>{`${d.day}: ${fmtWage(d.burned)} WAGE burned`}</title>
            </rect>
            {(data.length <= 8 || i % Math.ceil(data.length / 6) === 0) && (
              <text x={x(i)} y={H - 5} textAnchor="middle" fontSize="10" fill="#6c7392">{d.day.slice(5)}</text>
            )}
          </g>
        );
      })}
      <path d={line} fill="none" stroke="#E6C36A" strokeWidth={1.8} />
    </svg>
  );
}

export function PriceChart({ points, graduatedAt }: { points: { t: string; usd: number | null; eth: number | null }[]; graduatedAt?: string }) {
  const useUsd = points.some((p) => p.usd != null);
  const series = points.map((p) => ({ t: new Date(p.t).getTime(), v: useUsd ? p.usd : p.eth })).filter((p): p is { t: number; v: number } => p.v != null);
  if (series.length < 2) return null;
  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const lo = Math.min(...series.map((p) => p.v)), hi = Math.max(...series.map((p) => p.v));
  const span = hi - lo || hi || 1;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const X = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * iw;
  const Y = (v: number) => PAD.t + ih - ((v - lo) / span) * ih;
  const d = series.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const g = graduatedAt ? new Date(graduatedAt).getTime() : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`$WAGE price in ${useUsd ? "USD" : "ETH"}`}>
      <path d={d} fill="none" stroke="#5FB3B0" strokeWidth={1.8} />
      {g != null && g >= t0 && g <= t1 && (
        <g>
          <line x1={X(g)} x2={X(g)} y1={PAD.t} y2={PAD.t + ih} stroke="#E6C36A" strokeDasharray="4 3" />
          <text x={X(g) + 4} y={PAD.t + 10} fontSize="10" fill="#E6C36A">Graduated to Uniswap v4</text>
        </g>
      )}
      <text x={PAD.l} y={H - 5} fontSize="10" fill="#6c7392">{new Date(t0).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</text>
      <text x={W - PAD.r} y={H - 5} textAnchor="end" fontSize="10" fill="#6c7392">{new Date(t1).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</text>
    </svg>
  );
}
