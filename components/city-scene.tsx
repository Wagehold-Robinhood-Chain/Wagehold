"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  DISTRICT_ORDER,
  WARD_COLOR_HEX,
  WARD_LABEL,
  type AgentStatus,
  type DistrictId,
} from "@/types/domain";

// API sama dengan versi three.js sebelumnya: <CityScene agents={...} />,
// jadi realtime-city-dashboard.tsx tidak perlu diubah.
export interface CityAgent {
  id: string;
  ticker: string;
  district: DistrictId;
  revenue30d: number;
  status: AgentStatus;
}

type Floor = "L1" | "L2";
const FLOOR_WARDS: Record<Floor, DistrictId[]> = {
  L1: ["research", "onchain", "creative"],
  L2: ["security", "community"],
};
const floorOf = (d: DistrictId): Floor => (FLOOR_WARDS.L1.includes(d) ? "L1" : "L2");

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: "#9aa1bd",
  working: "#e6a92a",
  review: "#4f86f0",
};

// Proyeksi isometrik: 1 tile = 32x16 px. Lantai 12x8 tile, ruangan 4x4 tile.
const TW = 32;
const TH = 16;
const OX = 300;
const OY = 56;
const W = 12;
const D = 8;
const RW = 4;
const WALL_H = 28;
const SLAB_T = 12;
const MAX_DESKS = 6;

type Pt = [number, number];
const P = (x: number, y: number, z = 0): Pt => [OX + (x - y) * TW, OY + (x + y) * TH - z];
const poly = (...a: Pt[]) => a.map((p) => p.join(",")).join(" ");

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const PLAZA_TREES: [number, number, number][] = [
  [1.0, 5.2, 1],
  [2.8, 6.9, 0.9],
  [4.3, 5.4, 1.1],
  [8.2, 5.3, 1],
  [9.8, 6.9, 1.1],
  [11.0, 5.2, 0.9],
  [0.8, 7.3, 0.8],
  [10.9, 7.4, 0.8],
];
const TERRACE_TREES: [number, number, number][] = [
  [9.0, 1.4, 1.1],
  [10.9, 1.1, 1],
  [9.7, 3.0, 0.9],
  [11.2, 3.1, 1.1],
];
const WALKERS: [number, number][] = [
  [6.0, 5.4],
  [6.2, 7.2],
  [3.4, 6.1],
  [7.6, 6.0],
];

function Slab() {
  return (
    <g>
      <polygon points={poly(P(0, D), P(W, D), P(W, D, -SLAB_T), P(0, D, -SLAB_T))} fill="#cdc7ba" />
      <polygon points={poly(P(W, 0), P(W, D), P(W, D, -SLAB_T), P(W, 0, -SLAB_T))} fill="#b9b3a5" />
      <polygon points={poly(P(0, 0), P(W, 0), P(W, D), P(0, D))} fill="#ebe8e1" />
      {/* taman + jalur di depan ruangan */}
      <polygon
        points={poly(P(0.4, 4.6), P(W - 0.4, 4.6), P(W - 0.4, D - 0.4), P(0.4, D - 0.4))}
        fill="#bcd8a4"
      />
      <polygon
        points={poly(P(5.3, 4.2), P(6.7, 4.2), P(6.7, D), P(5.3, D))}
        fill="#f6f3ec"
      />
    </g>
  );
}

function Room({ ward, index, dim, extra }: { ward: DistrictId; index: number; dim: boolean; extra: number }) {
  const c = WARD_COLOR_HEX[ward];
  const rx = index * RW;
  const ry = 0;
  const label = WARD_LABEL[ward];
  const [lx, ly] = P(rx + RW / 2, ry, WALL_H + 12);
  const w = label.length * 5.8 + 18;
  return (
    <g opacity={dim ? 0.35 : 1} style={{ transition: "opacity .25s" }}>
      <polygon
        points={poly(P(rx, ry), P(rx + RW, ry), P(rx + RW, ry + RW), P(rx, ry + RW))}
        fill={shade(c, 0.8)}
        stroke={shade(c, 0.3)}
        strokeWidth={1}
      />
      {/* Dinding samping cuma di ruangan pertama: dinding di x=rx ruangan lain
          akan berdiri di DEPAN ruangan sebelahnya dan menutupinya. */}
      {index === 0 && (
        <polygon
          points={poly(P(rx, ry), P(rx, ry + RW), P(rx, ry + RW, WALL_H), P(rx, ry, WALL_H))}
          fill={shade(c, 0.1)}
        />
      )}
      <polygon
        points={poly(P(rx, ry), P(rx + RW, ry), P(rx + RW, ry, WALL_H), P(rx, ry, WALL_H))}
        fill={shade(c, 0.35)}
      />
      <polyline
        points={poly(P(rx, index === 0 ? ry + RW : ry, WALL_H), P(rx, ry, WALL_H), P(rx + RW, ry, WALL_H))}
        fill="none"
        stroke="#fff"
        strokeWidth={1.5}
      />
      <g>
        <rect x={lx - w / 2} y={ly - 10} width={w} height={17} rx={8.5} fill={c} />
        <text x={lx} y={ly + 2} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#fff" letterSpacing={0.3}>
          {label}
        </text>
      </g>
      {extra > 0 && (
        <text x={P(rx + 3.6, ry + 3.6)[0]} y={P(rx + 3.6, ry + 3.6)[1]} textAnchor="middle" fontSize={8} fill="#4a516d">
          +{extra}
        </text>
      )}
    </g>
  );
}

function Person({ x, y, color, status, reduce }: { x: number; y: number; color: string; status?: AgentStatus; reduce: boolean }) {
  const [px, py] = P(x, y);
  const sc = status ? STATUS_COLOR[status] : null;
  return (
    <g>
      <ellipse cx={px} cy={py} rx={6} ry={2.6} fill="#000" opacity={0.15} />
      <rect x={px - 4.5} y={py - 15} width={9} height={13} rx={4.5} fill={color} />
      <circle cx={px} cy={py - 19} r={4} fill="#f0d2b6" />
      {sc && (
        <circle cx={px} cy={py - 30} r={3.2} fill={sc} stroke="#fff" strokeWidth={1}>
          {status === "working" && !reduce && (
            <>
              <animate attributeName="r" values="3.2;8" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;0.25" dur="1.6s" repeatCount="indefinite" />
            </>
          )}
        </circle>
      )}
    </g>
  );
}

function Agent({ a, x, y, dim, reduce, onOpen }: { a: CityAgent; x: number; y: number; dim: boolean; reduce: boolean; onOpen: () => void }) {
  const c = WARD_COLOR_HEX[a.district];
  const dw = 1.0;
  const dd = 0.6;
  const h = 9;
  const screen = a.status === "working" ? "#ffd166" : a.status === "review" ? "#8fb4ff" : "#2a3050";
  const [tx, ty] = P(x + 0.5, y + 1.05);
  return (
    <g
      role="link"
      tabIndex={0}
      aria-label={`${a.ticker}, ${a.status}`}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      opacity={dim ? 0.35 : 1}
      className="cursor-pointer outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100"
    >
      <title>{`$${a.ticker} · ${a.status}`}</title>
      <polygon points={poly(P(x, y + dd, h), P(x + dw, y + dd, h), P(x + dw, y + dd), P(x, y + dd))} fill="#d9d4c8" />
      <polygon points={poly(P(x + dw, y, h), P(x + dw, y + dd, h), P(x + dw, y + dd), P(x + dw, y))} fill="#c4beb0" />
      <polygon points={poly(P(x, y, h), P(x + dw, y, h), P(x + dw, y + dd, h), P(x, y + dd, h))} fill="#f7f5f0" />
      <polygon
        points={poly(P(x + 0.25, y + 0.15, h), P(x + 0.75, y + 0.15, h), P(x + 0.75, y + 0.15, h + 8), P(x + 0.25, y + 0.15, h + 8))}
        fill={screen}
      />
      <Person x={x + 0.5} y={y + 0.95} color={c} status={a.status} reduce={reduce} />
      <text x={tx} y={ty + 9} textAnchor="middle" fontSize={7.5} fontWeight={700} fill="#4a516d">
        ${a.ticker}
      </text>
    </g>
  );
}

function Tree({ x, y, s }: { x: number; y: number; s: number }) {
  const [px, py] = P(x, y);
  return (
    <g>
      <ellipse cx={px} cy={py} rx={11 * s} ry={4 * s} fill="#000" opacity={0.12} />
      <rect x={px - 2} y={py - 12 * s} width={4} height={12 * s} fill="#7a5a3a" />
      <circle cx={px} cy={py - 22 * s} r={11 * s} fill="#4f9a58" />
      <circle cx={px - 6 * s} cy={py - 15 * s} r={8 * s} fill="#64b06a" />
      <circle cx={px + 6 * s} cy={py - 16 * s} r={8 * s} fill="#3f8749" />
    </g>
  );
}

export function CityScene({ agents }: { agents: CityAgent[] }) {
  const router = useRouter();
  const reduce = !!useReducedMotion();
  const [floor, setFloor] = useState<Floor>("L1");
  const [focus, setFocus] = useState<DistrictId | null>(null);

  const byWard = useMemo(() => {
    const m = {} as Record<DistrictId, CityAgent[]>;
    DISTRICT_ORDER.forEach((d) => (m[d] = []));
    agents.forEach((a) => m[a.district]?.push(a));
    DISTRICT_ORDER.forEach((d) => m[d].sort((a, b) => a.ticker.localeCompare(b.ticker)));
    return m;
  }, [agents]);

  const working = agents.filter((a) => a.status === "working").length;
  const wards = FLOOR_WARDS[floor];

  // Painter's algorithm: gambar dari yang paling jauh (x+y kecil) ke yang paling dekat.
  const items: { d: number; k: string; n: ReactNode }[] = [];
  wards.forEach((w, i) => {
    const shown = byWard[w].slice(0, MAX_DESKS);
    const cols = shown.length > 4 ? 3 : 2;
    shown.forEach((a, j) => {
      // Baris berjarak 1.85 tile supaya label $TICKER tidak tertimpa meja baris berikutnya.
      const x = i * RW + (cols === 3 ? 0.3 + (j % 3) * 1.25 : 0.7 + (j % 2) * 1.9);
      const y = 0.4 + Math.floor(j / cols) * 1.85;
      items.push({
        d: x + y + 0.6,
        k: a.id,
        n: (
          <Agent
            a={a}
            x={x}
            y={y}
            dim={!!focus && focus !== w}
            reduce={reduce}
            onOpen={() => router.push(`/agents/${a.id}`)}
          />
        ),
      });
    });
  });
  [...PLAZA_TREES, ...(floor === "L2" ? TERRACE_TREES : [])].forEach(([x, y, s], i) =>
    items.push({ d: x + y, k: `t${i}`, n: <Tree x={x} y={y} s={s} /> })
  );
  WALKERS.forEach(([x, y], i) =>
    items.push({ d: x + y, k: `w${i}`, n: <Person x={x} y={y} color="#3b4058" reduce={reduce} /> })
  );
  items.sort((a, b) => a.d - b.d);

  return (
    <div className="grid gap-3 md:grid-cols-[210px_1fr]">
      {/* Daftar Ward: klik = pindah lantai + sorot ruangan */}
      <nav aria-label="Wards" className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-2">
        {DISTRICT_ORDER.map((d) => {
          const list = byWard[d];
          const busy = list.filter((a) => a.status === "working").length;
          const on = focus === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => {
                setFocus(on ? null : d);
                if (!on) setFloor(floorOf(d));
              }}
              className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                on ? "bg-surface-2" : "hover:bg-surface-2/60"
              }`}
            >
              <span className="h-7 w-7 shrink-0 rounded-lg" style={{ background: WARD_COLOR_HEX[d] }} />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-semibold text-text">{WARD_LABEL[d]}</span>
                <span className="block text-[11px] text-muted">
                  {list.length} Wright{busy > 0 ? ` · ${busy} working` : ""} · {floorOf(d)}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="relative overflow-hidden rounded-xl border border-line" style={{ background: "linear-gradient(#f3f4f8,#e4e7ef)" }}>
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#3b4058] shadow-sm">
          <span className="h-2 w-2 rounded-full bg-[#3fbf7f]" />
          {working}/{agents.length} working
        </div>

        <div className="absolute bottom-3 left-3 z-10 flex gap-3 rounded-full bg-white/90 px-3 py-1 text-[10.5px] text-[#4a516d] shadow-sm">
          {(Object.keys(STATUS_COLOR) as AgentStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
              {s}
            </span>
          ))}
        </div>

        <div className="absolute bottom-3 right-3 z-10 flex flex-col overflow-hidden rounded-lg bg-white/95 shadow-sm">
          {(["L2", "L1"] as Floor[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFloor(f)}
              aria-pressed={floor === f}
              className={`h-8 w-9 text-[11px] font-bold ${floor === f ? "bg-[#5b4fe0] text-white" : "text-[#4a516d] hover:bg-[#eceef5]"}`}
            >
              {f}
            </button>
          ))}
        </div>

        <svg viewBox="0 0 720 410" className="block h-auto w-full" role="img" aria-label={`Wagehold city, floor ${floor}`}>
          <AnimatePresence mode="wait">
            <motion.g
              key={floor}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <Slab />
              {wards.map((w, i) => (
                <Room
                  key={w}
                  ward={w}
                  index={i}
                  dim={!!focus && focus !== w}
                  extra={Math.max(0, byWard[w].length - MAX_DESKS)}
                />
              ))}
              {items.map((it) => (
                <g key={it.k}>{it.n}</g>
              ))}
            </motion.g>
          </AnimatePresence>
        </svg>
      </div>
    </div>
  );
}
