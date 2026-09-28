'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  AnimatePresence,
  motion,
  useAnimationFrame,
  useReducedMotion,
} from 'motion/react';
import {
  DISTRICT_ORDER,
  WARD_COLOR_HEX,
  WARD_LABEL,
  type AgentStatus,
  type DistrictId,
} from '@/types/domain';

// API sama dengan versi sebelumnya: <CityScene agents={...} />,
// jadi realtime-city-dashboard.tsx tidak perlu diubah.
export interface CityAgent {
  id: string;
  ticker: string;
  district: DistrictId;
  revenue30d: number;
  status: AgentStatus;
}

type Floor = 'L1' | 'L2';
const FLOOR_WARDS: Record<Floor, DistrictId[]> = {
  L1: ['research', 'onchain', 'creative'],
  L2: ['security', 'community'],
};
const floorOf = (d: DistrictId): Floor =>
  FLOOR_WARDS.L1.includes(d) ? 'L1' : 'L2';

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: '#9aa1bd',
  working: '#e6a92a',
  review: '#4f86f0',
};

// Proyeksi isometrik: 1 tile = 32x16 px. Lantai 12x8 tile, ruangan 4x4 tile.
const TW = 32;
const TH = 16;
const CX = 360; // titik pusat lantai di layar (viewBox 720x410)
const CY = 210;
const W = 12;
const D = 8;
const MX = W / 2; // pusat putaran (dunia)
const MY = D / 2;
const RW = 4;
const WALL_H = 28;
const SLAB_T = 12;
const MAX_DESKS = 6;

// Drag: 0.4 derajat per piksel geser (~900px = 1 putaran). Setelah dilepas kota
// meluncur dengan inersia; INERTIA_MS = seberapa cepat lajunya meredam.
const DRAG_DEG_PER_PX = 0.4;
const INERTIA_MS = 400;
const NUDGE_DEG = 45; // tombol ‹ ›
const norm = (a: number) => ((a % 360) + 360) % 360;

type Pt = [number, number];
const poly = (...a: Pt[]) => a.map((p) => p.join(',')).join(' ');

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) =>
    Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ---------------------------------------------------------------------------
// View: semua koordinat dunia diputar mengelilingi pusat lantai sebelum
// diproyeksikan. Kamera tetap; yang berputar adalah "piringan"-nya.
// ---------------------------------------------------------------------------
interface View {
  P: (x: number, y: number, z?: number) => Pt;
  /** Kedalaman: makin besar = makin dekat ke kamera (untuk painter's algorithm). */
  dep: (x: number, y: number) => number;
  /** Apakah sisi dengan normal dunia (nx, ny) menghadap kamera? */
  vis: (nx: number, ny: number) => boolean;
  /** Warna sisi luar (kotak) dengan pencahayaan sesuai arah muka. */
  side: (base: string, nx: number, ny: number) => string;
  /** Warna sisi dalam dinding (yang terlihat kamera). */
  wall: (base: string, nx: number, ny: number) => string;
}

function makeView(deg: number): View {
  const th = (deg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const rot = (x: number, y: number): Pt => {
    const u = x - MX;
    const v = y - MY;
    return [u * c - v * s, u * s + v * c];
  };
  // t = -1 (muka menghadap kiri-bawah, terang) .. +1 (kanan-bawah, gelap)
  const t = (nx: number, ny: number) =>
    (nx * c - ny * s - (nx * s + ny * c)) / Math.SQRT2;
  return {
    P: (x, y, z = 0) => {
      const [a, b] = rot(x, y);
      return [CX + (a - b) * TW, CY + (a + b) * TH - z];
    },
    dep: (x, y) => {
      const [a, b] = rot(x, y);
      return a + b;
    },
    vis: (nx, ny) => nx * c - ny * s + (nx * s + ny * c) > 1e-6,
    side: (base, nx, ny) => shade(base, -0.03 - 0.07 * t(nx, ny)),
    wall: (base, nx, ny) => shade(base, 0.22 - 0.18 * t(-nx, -ny)),
  };
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

// Muncul dengan jatuh pelan dari atas + fade. Dipakai untuk semua elemen kota
// dengan delay berbeda-beda supaya tampil satu per satu.
function Pop({
  delay,
  reduce,
  from = 14,
  children,
}: {
  delay: number;
  reduce: boolean;
  from?: number;
  children: ReactNode;
}) {
  if (reduce) return <g>{children}</g>;
  return (
    <motion.g
      initial={{ opacity: 0, y: -from }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.g>
  );
}

// Kotak generik: hanya menggambar sisi yang menghadap kamera, lalu atapnya.
function Box({
  v,
  x,
  y,
  dx,
  dy,
  z0,
  z1,
  base,
  top,
}: {
  v: View;
  x: number;
  y: number;
  dx: number;
  dy: number;
  z0: number;
  z1: number;
  base: string;
  top: string;
}) {
  const { P } = v;
  const faces: { n: Pt; pts: Pt[] }[] = [
    {
      n: [0, 1],
      pts: [
        P(x, y + dy, z1),
        P(x + dx, y + dy, z1),
        P(x + dx, y + dy, z0),
        P(x, y + dy, z0),
      ],
    },
    {
      n: [1, 0],
      pts: [
        P(x + dx, y, z1),
        P(x + dx, y + dy, z1),
        P(x + dx, y + dy, z0),
        P(x + dx, y, z0),
      ],
    },
    {
      n: [0, -1],
      pts: [P(x, y, z1), P(x + dx, y, z1), P(x + dx, y, z0), P(x, y, z0)],
    },
    {
      n: [-1, 0],
      pts: [P(x, y, z1), P(x, y + dy, z1), P(x, y + dy, z0), P(x, y, z0)],
    },
  ];
  return (
    <g>
      {faces
        .filter((f) => v.vis(f.n[0], f.n[1]))
        .map((f, i) => (
          <polygon
            key={i}
            points={poly(...f.pts)}
            fill={v.side(base, f.n[0], f.n[1])}
          />
        ))}
      <polygon
        points={poly(
          P(x, y, z1),
          P(x + dx, y, z1),
          P(x + dx, y + dy, z1),
          P(x, y + dy, z1),
        )}
        fill={top}
      />
    </g>
  );
}

function Slab({ v }: { v: View }) {
  const { P } = v;
  return (
    <g>
      <Box
        v={v}
        x={0}
        y={0}
        dx={W}
        dy={D}
        z0={-SLAB_T}
        z1={0}
        base="#c9c3b6"
        top="#ebe8e1"
      />
      {/* taman + jalur di depan ruangan */}
      <polygon
        points={poly(
          P(0.4, 4.6),
          P(W - 0.4, 4.6),
          P(W - 0.4, D - 0.4),
          P(0.4, D - 0.4),
        )}
        fill="#bcd8a4"
      />
      <polygon
        points={poly(P(5.3, 4.2), P(6.7, 4.2), P(6.7, D), P(5.3, D))}
        fill="#f6f3ec"
      />
    </g>
  );
}

function RoomFloor({
  v,
  ward,
  index,
  dim,
}: {
  v: View;
  ward: DistrictId;
  index: number;
  dim: boolean;
}) {
  const { P } = v;
  const c = WARD_COLOR_HEX[ward];
  const rx = index * RW;
  return (
    <polygon
      points={poly(P(rx, 0), P(rx + RW, 0), P(rx + RW, RW), P(rx, RW))}
      fill={shade(c, 0.8)}
      stroke={shade(c, 0.3)}
      strokeWidth={1}
      opacity={dim ? 0.35 : 1}
      style={{ transition: 'opacity .25s' }}
    />
  );
}

// Dinding hanya digambar di sisi yang MEMBELAKANGI kamera. Sekat antar ruangan
// dilewati: berdiri di depan ruangan sebelahnya dan akan menutupinya.
function RoomWalls({
  v,
  ward,
  index,
  count,
  dim,
}: {
  v: View;
  ward: DistrictId;
  index: number;
  count: number;
  dim: boolean;
}) {
  const c = WARD_COLOR_HEX[ward];
  const x0 = index * RW;
  const x1 = x0 + RW;
  const sides: { p: Pt; q: Pt; n: Pt }[] = [
    { p: [x0, 0], q: [x1, 0], n: [0, -1] },
    { p: [x0, RW], q: [x1, RW], n: [0, 1] },
  ];
  if (index === 0) sides.push({ p: [x0, 0], q: [x0, RW], n: [-1, 0] });
  if (index === count - 1) sides.push({ p: [x1, 0], q: [x1, RW], n: [1, 0] });
  return (
    <g opacity={dim ? 0.35 : 1} style={{ transition: 'opacity .25s' }}>
      {sides
        .filter((s) => !v.vis(s.n[0], s.n[1]))
        .map((s, i) => {
          const a = v.P(s.p[0], s.p[1]);
          const b = v.P(s.q[0], s.q[1]);
          const at = v.P(s.p[0], s.p[1], WALL_H);
          const bt = v.P(s.q[0], s.q[1], WALL_H);
          return (
            <g key={i}>
              <polygon
                points={poly(a, b, bt, at)}
                fill={v.wall(c, s.n[0], s.n[1])}
              />
              <polyline
                points={poly(at, bt)}
                fill="none"
                stroke="#fff"
                strokeWidth={1.5}
              />
            </g>
          );
        })}
    </g>
  );
}

function RoomLabel({
  v,
  ward,
  index,
  dim,
  extra,
}: {
  v: View;
  ward: DistrictId;
  index: number;
  dim: boolean;
  extra: number;
}) {
  const c = WARD_COLOR_HEX[ward];
  const text = extra > 0 ? `${WARD_LABEL[ward]} +${extra}` : WARD_LABEL[ward];
  // Label melayang tetap di atas ruangan supaya tidak melompat saat kota berputar.
  const [lx, ly] = v.P(index * RW + RW / 2, RW / 2, 92);
  const w = text.length * 5.8 + 18;
  return (
    <g
      opacity={dim ? 0.35 : 1}
      style={{ transition: 'opacity .25s' }}
      pointerEvents="none"
    >
      <rect
        x={lx - w / 2}
        y={ly - 10}
        width={w}
        height={17}
        rx={8.5}
        fill={c}
      />
      <text
        x={lx}
        y={ly + 2}
        textAnchor="middle"
        fontSize={9.5}
        fontWeight={700}
        fill="#fff"
        letterSpacing={0.3}
      >
        {text}
      </text>
    </g>
  );
}

function Person({
  v,
  x,
  y,
  color,
  status,
  reduce,
}: {
  v: View;
  x: number;
  y: number;
  color: string;
  status?: AgentStatus;
  reduce: boolean;
}) {
  const [px, py] = v.P(x, y);
  const sc = status ? STATUS_COLOR[status] : null;
  return (
    <g>
      <ellipse cx={px} cy={py} rx={6} ry={2.6} fill="#000" opacity={0.15} />
      <rect
        x={px - 4.5}
        y={py - 15}
        width={9}
        height={13}
        rx={4.5}
        fill={color}
      />
      <circle cx={px} cy={py - 19} r={4} fill="#f0d2b6" />
      {sc && (
        <circle
          cx={px}
          cy={py - 30}
          r={3.2}
          fill={sc}
          stroke="#fff"
          strokeWidth={1}
        >
          {status === 'working' && !reduce && (
            <>
              <animate
                attributeName="r"
                values="3.2;8"
                dur="1.6s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="1;0.25"
                dur="1.6s"
                repeatCount="indefinite"
              />
            </>
          )}
        </circle>
      )}
    </g>
  );
}

// Meja + monitor. Orangnya digambar terpisah supaya bisa diurutkan sendiri
// (di sudut pandang tertentu dia ada di belakang meja).
function Desk({ v, a, x, y }: { v: View; a: CityAgent; x: number; y: number }) {
  const { P } = v;
  const h = 9;
  const front = v.vis(0, 1); // monitor menghadap +y
  const screen = !front
    ? '#3a3f57'
    : a.status === 'working'
      ? '#ffd166'
      : a.status === 'review'
        ? '#8fb4ff'
        : '#2a3050';
  return (
    <g>
      <Box
        v={v}
        x={x}
        y={y}
        dx={1.0}
        dy={0.6}
        z0={0}
        z1={h}
        base="#cfc9bb"
        top="#f7f5f0"
      />
      <polygon
        points={poly(
          P(x + 0.25, y + 0.15, h),
          P(x + 0.75, y + 0.15, h),
          P(x + 0.75, y + 0.15, h + 8),
          P(x + 0.25, y + 0.15, h + 8),
        )}
        fill={screen}
      />
    </g>
  );
}

function Tree({ v, x, y, s }: { v: View; x: number; y: number; s: number }) {
  const [px, py] = v.P(x, y);
  return (
    <g>
      <ellipse
        cx={px}
        cy={py}
        rx={11 * s}
        ry={4 * s}
        fill="#000"
        opacity={0.12}
      />
      <rect
        x={px - 2}
        y={py - 12 * s}
        width={4}
        height={12 * s}
        fill="#7a5a3a"
      />
      <circle cx={px} cy={py - 22 * s} r={11 * s} fill="#4f9a58" />
      <circle cx={px - 6 * s} cy={py - 15 * s} r={8 * s} fill="#64b06a" />
      <circle cx={px + 6 * s} cy={py - 16 * s} r={8 * s} fill="#3f8749" />
    </g>
  );
}

interface Item {
  d: number;
  k: string;
  n: ReactNode;
  delay: number;
}

export function CityScene({ agents }: { agents: CityAgent[] }) {
  const router = useRouter();
  const reduce = !!useReducedMotion();
  const [floor, setFloor] = useState<Floor>('L1');
  const [focus, setFocus] = useState<DistrictId | null>(null);
  const [angle, setAngle] = useState(0); // derajat
  const [grabbing, setGrabbing] = useState(false);

  const drag = useRef<{
    startX: number;
    x: number;
    t: number;
    moved: boolean;
  } | null>(null);
  const vel = useRef(0); // derajat/ms, dipakai untuk inersia
  const suppressClick = useRef(false); // drag tidak boleh dihitung sebagai klik meja
  // Animasi masuk berurutan hanya saat kota (atau lantai) baru muncul. Sesudahnya
  // delay = 0 supaya Wright yang datang lewat realtime langsung tampil.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    setIntro(true);
    const t = setTimeout(() => setIntro(false), 3200);
    return () => clearTimeout(t);
  }, [floor]);
  const dl = (sec: number) => (intro ? sec : 0);

  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;

  // Inersia: setelah dilepas, putaran melambat pelan-pelan.
  useAnimationFrame((_, delta) => {
    if (drag.current || Math.abs(vel.current) < 0.004) return;
    const dt = Math.min(delta, 50);
    setAngle((a) => norm(a + vel.current * dt));
    vel.current *= Math.exp(-dt / INERTIA_MS);
  });

  // Listener di window supaya drag tetap jalan walau kursor keluar dari kotak scene.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.abs(e.clientX - d.startX) < 4) return;
      const now = performance.now();
      const deg = -(e.clientX - d.x) * DRAG_DEG_PER_PX; // geser ke kanan = bagian depan ikut ke kanan
      d.moved = true;
      setAngle((a) => norm(a + deg));
      vel.current = 0.6 * (deg / Math.max(now - d.t, 1)) + 0.4 * vel.current;
      d.x = e.clientX;
      d.t = now;
    };
    const up = () => {
      const d = drag.current;
      if (!d) return;
      if (d.moved) suppressClick.current = true;
      // Tahan lama sebelum dilepas, atau reduced-motion = tidak meluncur.
      if (reduceRef.current || performance.now() - d.t > 80) vel.current = 0;
      drag.current = null;
      setGrabbing(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const nudge = (dir: 1 | -1) => {
    if (reduce) setAngle((a) => norm(a - dir * NUDGE_DEG));
    else vel.current = (-dir * NUDGE_DEG) / INERTIA_MS; // meluncur tepat ~45 derajat
  };

  const byWard = useMemo(() => {
    const m = {} as Record<DistrictId, CityAgent[]>;
    DISTRICT_ORDER.forEach((d) => (m[d] = []));
    agents.forEach((a) => m[a.district]?.push(a));
    DISTRICT_ORDER.forEach((d) =>
      m[d].sort((a, b) => a.ticker.localeCompare(b.ticker)),
    );
    return m;
  }, [agents]);

  const working = agents.filter((a) => a.status === 'working').length;
  const wards = FLOOR_WARDS[floor];
  const v = makeView(angle);

  // Posisi meja (koordinat dunia, tidak tergantung sudut putar).
  const placed = wards.flatMap((w, i) => {
    const shown = byWard[w].slice(0, MAX_DESKS);
    const cols = shown.length > 4 ? 3 : 2;
    return shown.map((a, j) => ({
      a,
      w,
      // Baris berjarak 1.85 tile supaya meja tidak saling menimpa.
      x: i * RW + (cols === 3 ? 0.3 + (j % 3) * 1.25 : 0.7 + (j % 2) * 1.9),
      y: 0.4 + Math.floor(j / cols) * 1.85,
    }));
  });

  const hitProps = (a: CityAgent, focusable: boolean) => ({
    onClick: () => router.push(`/agents/${a.id}`),
    ...(focusable
      ? {
          role: 'link' as const,
          tabIndex: 0,
          'aria-label': `${a.ticker}, ${a.status}`,
          onKeyDown: (e: React.KeyboardEvent) =>
            e.key === 'Enter' && router.push(`/agents/${a.id}`),
        }
      : { 'aria-hidden': true as const }),
  });
  const hitClass =
    'cursor-pointer outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100';

  // Painter's algorithm: yang paling jauh digambar duluan. Urutannya dihitung
  // ulang tiap frame karena "jauh" berubah saat kota berputar.
  const inBlock = (x: number, y: number) =>
    x >= 0 && x <= wards.length * RW && y >= 0 && y <= RW;
  const blockDep = v.dep((wards.length * RW) / 2, RW / 2);
  const behind: Item[] = []; // di luar bangunan & di belakang dinding jauh
  const front: Item[] = []; // di dalam ruangan, atau di luar tapi di depan

  const deskDelay = (idx: number) => dl(0.6 + idx * 0.06);
  placed.forEach(({ a, w, x, y }, idx) => {
    const dim = !!focus && focus !== w;
    front.push({
      d: v.dep(x + 0.5, y + 0.3),
      k: `d-${a.id}`,
      delay: deskDelay(idx),
      n: (
        <g {...hitProps(a, true)} opacity={dim ? 0.35 : 1} className={hitClass}>
          <title>{`$${a.ticker} · ${a.status}`}</title>
          <Desk v={v} a={a} x={x} y={y} />
        </g>
      ),
    });
    front.push({
      d: v.dep(x + 0.5, y + 0.95),
      k: `p-${a.id}`,
      delay: deskDelay(idx) + (intro ? 0.15 : 0),
      n: (
        <g
          {...hitProps(a, false)}
          opacity={dim ? 0.35 : 1}
          className={hitClass}
        >
          <Person
            v={v}
            x={x + 0.5}
            y={y + 0.95}
            color={WARD_COLOR_HEX[a.district]}
            status={a.status}
            reduce={reduce}
          />
        </g>
      ),
    });
  });

  const addOutside = (
    x: number,
    y: number,
    k: string,
    delay: number,
    n: ReactNode,
  ) => {
    const d = v.dep(x, y);
    (!inBlock(x, y) && d < blockDep ? behind : front).push({ d, k, n, delay });
  };
  [...PLAZA_TREES, ...(floor === 'L2' ? TERRACE_TREES : [])].forEach(
    ([x, y, s], i) =>
      addOutside(
        x,
        y,
        `t${i}`,
        dl(0.5 + i * 0.06),
        <Tree v={v} x={x} y={y} s={s} />,
      ),
  );
  WALKERS.forEach(([x, y], i) =>
    addOutside(
      x,
      y,
      `w${i}`,
      dl(1.0 + i * 0.1),
      <Person v={v} x={x} y={y} color="#3b4058" reduce={reduce} />,
    ),
  );
  behind.sort((a, b) => a.d - b.d);
  front.sort((a, b) => a.d - b.d);

  return (
    <div className="grid gap-3 md:grid-cols-[210px_1fr]">
      {/* Daftar Ward: klik = pindah lantai + sorot ruangan */}
      <nav
        aria-label="Wards"
        className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-2"
      >
        {DISTRICT_ORDER.map((d) => {
          const list = byWard[d];
          const busy = list.filter((a) => a.status === 'working').length;
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
                on ? 'bg-surface-2' : 'hover:bg-surface-2/60'
              }`}
            >
              <span
                className="h-7 w-7 shrink-0 rounded-lg"
                style={{ background: WARD_COLOR_HEX[d] }}
              />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-semibold text-text">
                  {WARD_LABEL[d]}
                </span>
                <span className="block text-[11px] text-muted">
                  {list.length} Wright{busy > 0 ? ` · ${busy} working` : ''} ·{' '}
                  {floorOf(d)}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div
        className={`relative touch-pan-y select-none overflow-hidden rounded-xl border border-line ${
          grabbing ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{ background: 'linear-gradient(#f3f4f8,#e4e7ef)' }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          if ((e.target as Element).closest('button')) return; // tombol tidak memulai drag
          suppressClick.current = false;
          vel.current = 0;
          drag.current = {
            startX: e.clientX,
            x: e.clientX,
            t: performance.now(),
            moved: false,
          };
          setGrabbing(true);
        }}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-[#3b4058] shadow-sm">
          <span className="h-2 w-2 rounded-full bg-[#3fbf7f]" />
          {working}/{agents.length} working
        </div>

        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full bg-white/90 px-1 py-0.5 text-[11px] font-semibold text-[#3b4058] shadow-sm">
          <button
            type="button"
            onClick={() => nudge(-1)}
            aria-label="Rotate left"
            className="h-6 w-6 rounded-full text-[14px] leading-none hover:bg-[#eceef5]"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => nudge(1)}
            aria-label="Rotate right"
            className="h-6 w-6 rounded-full text-[14px] leading-none hover:bg-[#eceef5]"
          >
            ›
          </button>
        </div>

        <div className="absolute bottom-3 left-3 z-10 flex gap-3 rounded-full bg-white/90 px-3 py-1 text-[10.5px] text-[#4a516d] shadow-sm">
          {(Object.keys(STATUS_COLOR) as AgentStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: STATUS_COLOR[s] }}
              />
              {s}
            </span>
          ))}
        </div>

        <div className="absolute bottom-3 right-3 z-10 flex flex-col overflow-hidden rounded-lg bg-white/95 shadow-sm">
          {(['L2', 'L1'] as Floor[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFloor(f)}
              aria-pressed={floor === f}
              className={`h-8 w-9 text-[11px] font-bold ${floor === f ? 'bg-[#5b4fe0] text-white' : 'text-[#4a516d] hover:bg-[#eceef5]'}`}
            >
              {f}
            </button>
          ))}
        </div>

        <svg
          viewBox="0 0 720 410"
          className="block h-auto w-full"
          role="img"
          aria-label={`Wagehold city, floor ${floor}`}
        >
          <AnimatePresence mode="wait">
            <motion.g
              key={floor}
              initial={false}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Pop delay={0} reduce={reduce} from={18}>
                <Slab v={v} />
              </Pop>
              {wards.map((w, i) => (
                <Pop key={w} delay={dl(0.15 + i * 0.12)} reduce={reduce}>
                  <RoomFloor
                    v={v}
                    ward={w}
                    index={i}
                    dim={!!focus && focus !== w}
                  />
                </Pop>
              ))}
              {behind.map((it) => (
                <Pop key={it.k} delay={it.delay} reduce={reduce}>
                  {it.n}
                </Pop>
              ))}
              {wards.map((w, i) => (
                <Pop key={w} delay={dl(0.3 + i * 0.12)} reduce={reduce}>
                  <RoomWalls
                    v={v}
                    ward={w}
                    index={i}
                    count={wards.length}
                    dim={!!focus && focus !== w}
                  />
                </Pop>
              ))}
              {front.map((it) => (
                <Pop key={it.k} delay={it.delay} reduce={reduce}>
                  {it.n}
                </Pop>
              ))}

              {/* Lapisan label: selalu di atas, tidak ikut terhalang objek lain */}
              {placed.map(({ a, w, x, y }, idx) => {
                const [tx, ty] = v.P(x + 0.5, y + 0.3);
                return (
                  <Pop
                    key={`l-${a.id}`}
                    delay={deskDelay(idx) + (intro ? 0.25 : 0)}
                    reduce={reduce}
                    from={4}
                  >
                    <text
                      x={tx}
                      y={ty + 15}
                      textAnchor="middle"
                      fontSize={7.5}
                      fontWeight={700}
                      fill="#4a516d"
                      stroke="#f3f4f8"
                      strokeWidth={2.5}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                      opacity={!!focus && focus !== w ? 0.35 : 1}
                      pointerEvents="none"
                    >
                      ${a.ticker}
                    </text>
                  </Pop>
                );
              })}
              {wards.map((w, i) => (
                <Pop
                  key={`rl-${w}`}
                  delay={dl(0.9 + placed.length * 0.06 + i * 0.12)}
                  reduce={reduce}
                  from={10}
                >
                  <RoomLabel
                    v={v}
                    ward={w}
                    index={i}
                    dim={!!focus && focus !== w}
                    extra={Math.max(0, byWard[w].length - MAX_DESKS)}
                  />
                </Pop>
              ))}
            </motion.g>
          </AnimatePresence>
        </svg>
      </div>
    </div>
  );
}
