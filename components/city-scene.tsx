'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as THREE from 'three';
import {
  DISTRICT_ORDER,
  WARD_COLOR_HEX,
  WARD_LABEL,
  type AgentStatus,
  type DistrictId,
} from '@/types/domain';

// Kota 3D dari wagehold-prototype.html: Counting House di tengah, 5 Ward
// melingkar dengan jalan, gedung Wright yang tingginya mengikuti revenue.
// API tetap: <CityScene agents={...} />, jadi realtime-city-dashboard.tsx
// tidak perlu diubah.
export interface CityAgent {
  id: string;
  code: string;
  district: DistrictId;
  revenue30d: number;
  status: AgentStatus;
}

// Layout & proporsi sama persis dengan prototipe.
const RING_RADIUS = 13.5;
const BUILDING_OFFSETS: [number, number][] = [
  [-1.9, -1.9],
  [1.9, -1.9],
  [-1.9, 1.9],
  [1.9, 1.9],
];
// Revenue = wage kotor (Revision 1); pembagi 1500 -> 2150 (=1500/0.7) supaya tinggi gedung
// tetap sama seperti saat revenue masih porsi patron 70%.
const heightFor = (revenue30d: number) => 1.2 + revenue30d / 2150;

const DRAG_RAD_PER_PX = 0.008;
const INERTIA_S = 0.4; // seberapa cepat putaran meredam setelah drag dilepas
const NUDGE_RAD = Math.PI / 4; // tombol ‹ ›

const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const easeBack = (k: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};

// ---------------------------------------------------------------------------
// Siang / malam mengikuti jam lokal browser user. 0 = malam penuh, 1 = siang
// penuh. Fajar ~05:15-06:45 dan senja ~17:15-18:45 (transisi mulus, dengan
// warna langit hangat di tengahnya).
// ---------------------------------------------------------------------------
type ThemeMode = 'auto' | 'day' | 'night';
const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
function daylightAt(d: Date) {
  const h = d.getHours() + d.getMinutes() / 60;
  return clamp01(smoothstep(5.25, 6.75, h) - smoothstep(17.25, 18.75, h));
}
const rgbaOf = (c: THREE.Color, a: number) =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

const SKY_DAY = [new THREE.Color('#fff3d6'), new THREE.Color('#a9d8fb')];
const SKY_DUSK = [new THREE.Color('#ffc58a'), new THREE.Color('#7f8ccf')];
const SKY_NIGHT = [new THREE.Color('#27305f'), new THREE.Color('#0a0e2a')];
function skyColor(day: number, i: 0 | 1, out: THREE.Color) {
  return day < 0.5
    ? out.copy(SKY_NIGHT[i]).lerp(SKY_DUSK[i], day / 0.5)
    : out.copy(SKY_DUSK[i]).lerp(SKY_DAY[i], (day - 0.5) / 0.5);
}

// Bintang: satu layer CSS dari radial-gradient kecil, posisi tetap (bukan random tiap render).
const STARS_BG = (() => {
  let a = 1234567;
  const rnd = () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
  return Array.from({ length: 46 }, () => {
    const x = (rnd() * 100).toFixed(1);
    const y = (rnd() * 78).toFixed(1);
    const r = (0.7 + rnd() * 0.9).toFixed(1);
    const o = (0.45 + rnd() * 0.5).toFixed(2);
    return `radial-gradient(${r}px ${r}px at ${x}% ${y}%, rgba(255,255,255,${o}) 50%, transparent 52%)`;
  }).join(',');
})();

// Jendela dibuat beda warna (biru, amber, cyan, pink) seperti ruangan-ruangan
// berwarna di gambar referensi; saat Wright "working" jendelanya menyala
// dengan warna masing-masing.
const WINDOW_TINTS = ['#3f78c8', '#ffb020', '#2fc4e4', '#ff6f91'];
function windowCanvas(emissive: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = emissive ? '#000' : '#ffffff';
  g.fillRect(0, 0, 64, 64);
  if (!emissive) {
    g.fillStyle = 'rgba(43,50,87,.09)'; // garis pemisah lantai
    g.fillRect(0, 60, 64, 4);
  }
  [
    [8, 10],
    [36, 10],
    [8, 38],
    [36, 38],
  ].forEach(([x, y], i) => {
    g.fillStyle = WINDOW_TINTS[i];
    g.fillRect(x, y, 20, 16);
    if (!emissive) {
      g.fillStyle = 'rgba(255,255,255,.35)'; // kilau kaca
      g.fillRect(x, y, 20, 4);
    }
  });
  return c;
}

// Ubin papan-catur berwarna untuk lantai tiap Ward.
function tileCanvas(color: THREE.Color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const white = new THREE.Color(0xffffff);
  const a = color.clone().lerp(white, 0.55).getStyle();
  const b = color.clone().lerp(white, 0.82).getStyle();
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++) {
      g.fillStyle = (i + j) % 2 ? a : b;
      g.fillRect(i * 16, j * 16, 16, 16);
    }
  return c;
}

// Plaza di sekeliling Counting House: cincin irisan berwarna Ward.
function plazaCanvas(colors: string[]) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff3d0';
  g.fillRect(0, 0, 256, 256);
  const n = colors.length * 2;
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.moveTo(128, 128);
    g.arc(128, 128, 122, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2);
    g.closePath();
    g.fillStyle = colors[i % colors.length];
    g.fill();
  }
  g.beginPath();
  g.arc(128, 128, 98, 0, Math.PI * 2);
  g.fillStyle = '#fff3d0';
  g.fill();
  g.beginPath();
  g.arc(128, 128, 96, 0, Math.PI * 2);
  g.strokeStyle = '#f3b93a';
  g.lineWidth = 5;
  g.stroke();
  return c;
}

// Label HTML di atas canvas. Gaya di-inline (bukan kelas Tailwind) karena
// elemennya dibuat lewat DOM API di luar React, jadi tidak ikut discan Tailwind.
// Palet terang: pil putih untuk code, papan berwarna Ward untuk nama Ward.
const INK = '#2b3257';

// Naikkan saturasi & normalkan kecerahan supaya warna Ward terlihat hidup
// (WARD_COLOR_HEX sengaja dibiarkan kalem karena dipakai juga di UI gelap).
function vivid(color: THREE.ColorRepresentation, sat = 1.6, light = 0.56) {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl, THREE.SRGBColorSpace);
  return new THREE.Color().setHSL(
    hsl.h,
    Math.min(1, hsl.s * sat),
    light,
    THREE.SRGBColorSpace,
  );
}
type LabelKind = 'bld' | 'dist' | 'hall';
function makeLabel(kind: LabelKind, text: string, color?: string) {
  const el = document.createElement('div');
  el.textContent = text;
  const s = el.style;
  s.position = 'absolute';
  s.whiteSpace = 'nowrap';
  if (kind === 'bld') {
    s.transform = 'translate(-50%,-100%)';
    s.fontFamily = 'var(--font-mono)';
    s.fontSize = '10px';
    s.fontWeight = '500';
    s.padding = '2px 7px';
    s.borderRadius = '999px';
    s.background = 'rgba(255,255,255,.94)';
    s.border = '1px solid rgba(43,50,87,.10)';
    s.boxShadow = '0 2px 6px rgba(43,50,87,.16)';
    s.color = INK;
  } else if (kind === 'dist') {
    // Papan nama berwarna Ward, seperti signage ruangan di gambar referensi.
    s.transform = 'translate(-50%,0)';
    s.fontFamily = 'var(--font-display)';
    s.fontSize = '11.5px';
    s.fontWeight = '700';
    s.letterSpacing = '.04em';
    s.textTransform = 'uppercase';
    s.padding = '3px 11px';
    s.borderRadius = '999px';
    s.background = vivid(color ?? '#888888', 1.6, 0.44).getStyle();
    s.boxShadow = '0 3px 8px rgba(43,50,87,.22)';
    s.color = '#fff';
  } else {
    s.transform = 'translate(-50%,-100%)';
    s.fontFamily = 'var(--font-body)';
    s.fontSize = '10.5px';
    s.fontWeight = '600';
    s.letterSpacing = '.06em';
    s.textTransform = 'uppercase';
    s.color = '#a0741a';
    s.textShadow = '0 0 6px #fff, 0 1px 0 #fff';
  }
  return el;
}
function highlightLabel(el: HTMLDivElement, on: boolean) {
  el.style.background = on ? INK : 'rgba(255,255,255,.94)';
  el.style.color = on ? '#fff' : INK;
}

// PRNG kecil dengan seed tetap supaya posisi pohon selalu sama tiap mount.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Tree {
  root: THREE.Group;
  phase: number;
}

interface Building {
  agentId: string;
  district: DistrictId;
  mesh: THREE.Mesh;
  wallMaterial: THREE.MeshLambertMaterial;
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
  beacon: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshLambertMaterial>;
  roofDeco: THREE.Group;
  flag: THREE.Mesh;
  label: HTMLDivElement;
  h: number;
  target: number;
  phase: number;
  glow: number;
  status: AgentStatus;
  revenue: number;
  delay: number; // detik, untuk animasi muncul satu per satu
}

interface Pop {
  o: THREE.Object3D;
  delay: number;
  dur: number;
  mode: 'uniform' | 'x';
  ease: (k: number) => number;
}

interface FlyingCoin {
  m: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  fade: boolean;
}

export function CityScene({
  agents,
  selectedId = null,
  onSelect,
  workRatioPct = null,
}: {
  agents: CityAgent[];
  /** Work Ratio 24 jam (persen) dari Weighhouse -- mengatur kilau jendela landmark Weighhouse.
   *  null = belum ada data (jendela redup). */
  workRatioPct?: number | null;
  /** Gedung yang sedang dipilih (ditandai outline + label gelap). */
  selectedId?: string | null;
  /** Klik gedung -> panggil ini (mis. buka Wright profile di panel kiri).
   *  Kalau tidak diberikan, klik langsung pindah ke /agents/[id]. */
  onSelect?: (id: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const nudgeRef = useRef<((dir: 1 | -1) => void) | null>(null);
  const router = useRouter();

  // Auto = ikuti jam lokal user; Day / Night = paksa (tombol kecil di pojok kanan atas).
  const [mode, setMode] = useState<ThemeMode>('auto');
  const modeRef = useRef<ThemeMode>('auto');
  const modeChanged = useRef(false);
  useEffect(() => {
    modeRef.current = mode;
    modeChanged.current = true;
  }, [mode]);

  // Data terbaru selalu lewat ref supaya loop animasi (di luar siklus render
  // React) tidak memegang closure data basi.
  const agentsRef = useRef(agents);
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);
  const workRatioRef = useRef<number | null>(workRatioPct);
  useEffect(() => {
    workRatioRef.current = workRatioPct;
  }, [workRatioPct]);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    selectedRef.current = selectedId;
    onSelectRef.current = onSelect;
  }, [selectedId, onSelect]);

  useEffect(() => {
    const stage = stageRef.current;
    const labelsEl = labelsRef.current;
    if (!stage || !labelsEl) return;

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const cv = renderer.domElement;
    cv.style.display = 'block';
    cv.style.width = '100%';
    cv.style.height = '100%';
    cv.style.touchAction = 'none';
    stage.insertBefore(cv, labelsEl);

    const scene = new THREE.Scene();
    const S = 30;
    const camera = new THREE.OrthographicCamera(-S, S, S, -S, -200, 400);
    let theta = Math.PI / 4;
    let thetaVel = 0; // rad/detik, inersia
    let zoom = 1;

    function placeCam() {
      const R = 60;
      camera.position.set(R * Math.cos(theta), R * 0.82, R * Math.sin(theta));
      camera.lookAt(0, 1.5, 0);
    }

    function resize() {
      const w = stage!.clientWidth;
      const h = stage!.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      const aspect = w / h;
      const v = aspect < 1 ? 23 / aspect : 20;
      camera.left = -v * aspect;
      camera.right = v * aspect;
      camera.top = v;
      camera.bottom = -v;
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }

    // Cahaya siang: langit putih + pantulan rumput, matahari hangat, dan fill
    // kebiruan dari sisi berlawanan supaya sisi gelap gedung tetap berwarna.
    // Intensitas x PI karena r155+ tidak lagi memakai "legacy lights".
    const hemi = new THREE.HemisphereLight(0xe4f1ff, 0x7cf04f, 0.66 * Math.PI);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe7b8, 0.85 * Math.PI);
    sun.position.set(20, 40, 10);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9cbcff, 0.3 * Math.PI);
    fill.position.set(-20, 15, -20);
    scene.add(fill);

    const ground = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 0.6, 64), [
      new THREE.MeshLambertMaterial({ color: 0xc8b48a }), // sisi: lempeng tanah
      new THREE.MeshLambertMaterial({ color: 0x4fd63a }), // atas: rumput hijau cerah
      new THREE.MeshLambertMaterial({ color: 0xc8b48a }),
    ]);
    ground.position.y = -0.5;
    scene.add(ground);

    const baseMap = new THREE.CanvasTexture(windowCanvas(false));
    baseMap.colorSpace = THREE.SRGBColorSpace;
    const baseEmissive = new THREE.CanvasTexture(windowCanvas(true));
    baseEmissive.colorSpace = THREE.SRGBColorSpace;

    const pops: Pop[] = [];

    // Counting House (Guild Hall)
    const hall = new THREE.Group();
    const hallBase = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.6, 1.2, 6),
      new THREE.MeshLambertMaterial({ color: 0xf0d9a8 }),
    );
    hallBase.position.y = 0.6;
    hall.add(hallBase);
    const hallTower = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 2.4, 3.2, 6),
      new THREE.MeshLambertMaterial({
        color: 0xffb020,
        emissive: 0x9a5a00,
        emissiveIntensity: 0.35,
      }),
    );
    hallTower.position.y = 2.8;
    hall.add(hallTower);
    const hallCap = new THREE.Mesh(
      new THREE.ConeGeometry(2.1, 1.6, 6),
      new THREE.MeshLambertMaterial({
        color: 0xffd23a,
        emissive: 0xb07800,
        emissiveIntensity: 0.35,
      }),
    );
    hallCap.position.y = 5.2;
    hall.add(hallCap);
    scene.add(hall);
    pops.push({
      o: hall,
      delay: 0.15,
      dur: 0.7,
      mode: 'uniform',
      ease: easeBack,
    });

    // Plaza berwarna di kaki Counting House (juga menutup celah ke rumput).
    const plazaMap = new THREE.CanvasTexture(
      plazaCanvas(
        DISTRICT_ORDER.map((d) =>
          vivid(WARD_COLOR_HEX[d], 1.6, 0.66).getStyle(),
        ),
      ),
    );
    plazaMap.colorSpace = THREE.SRGBColorSpace;
    const plaza = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.3, 0.24, 48),
      [
        new THREE.MeshLambertMaterial({ color: 0xf0d9a8 }),
        new THREE.MeshLambertMaterial({ map: plazaMap }),
        new THREE.MeshLambertMaterial({ color: 0xf0d9a8 }),
      ],
    );
    plaza.position.y = -0.08;
    scene.add(plaza);
    pops.push({
      o: plaza,
      delay: 0.05,
      dur: 0.6,
      mode: 'uniform',
      ease: easeOut,
    });

    // Halo emas berputar di sekeliling menara Counting House.
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(2.75, 0.07, 8, 56),
      new THREE.MeshLambertMaterial({
        color: 0xffd23a,
        emissive: 0xffa800,
        emissiveIntensity: 0.6,
      }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 4.3;
    hall.add(halo);

    // Dipakai bersama oleh pohon, semak, dan taman atap.
    const blobGeo = new THREE.IcosahedronGeometry(1, 0);
    const leafMats = [
      0x2ecb4a, 0x5ee63a, 0x1fc56e, 0x8cf24a, 0xb2f04a, 0x14bf8c,
    ].map(
      (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }),
    );
    // PRNG terpisah untuk semua dekorasi baru, supaya posisi pohon (yang
    // memakai `rand`) tetap sama persis seperti sebelumnya.
    const rand2 = mulberry32(880031);
    const pick2 = <T,>(arr: T[]) => arr[Math.floor(rand2() * arr.length)];

    const buildings = new Map<string, Building>();
    const pickables: THREE.Mesh[] = [];

    // Weighhouse: landmark kecil di samping Counting House, dengan timbangan di atap.
    // Kilau jendelanya mengikuti Work Ratio 24 jam (lihat `weighGlow` di loop frame).
    // Klik -> /weighhouse (ditangani khusus di endDrag lewat WEIGH_ID).
    const WEIGH_ANGLE = -Math.PI / 5; // di antara dua Ward, di luar plaza (radius 5.2)
    const WEIGH_R = 7.4;
    const weigh = new THREE.Group();
    weigh.position.set(Math.cos(WEIGH_ANGLE) * WEIGH_R, 0, Math.sin(WEIGH_ANGLE) * WEIGH_R);
    const weighBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 1.5, 1.5),
      new THREE.MeshLambertMaterial({ color: 0xe9e1cf }),
    );
    weighBody.position.y = 0.75;
    weigh.add(weighBody);
    const weighWinMat = new THREE.MeshLambertMaterial({
      color: 0xffe9a8,
      emissive: 0xffb020,
      emissiveIntensity: 0.1,
    });
    for (const wx of [-0.55, 0.55]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.06), weighWinMat);
      win.position.set(wx, 0.85, 0.77);
      weigh.add(win);
    }
    const weighRoof = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.18, 1.7),
      new THREE.MeshLambertMaterial({ color: 0x56608a }),
    );
    weighRoof.position.y = 1.59;
    weigh.add(weighRoof);
    // Timbangan: tiang + balok + dua piring.
    const brassMat = new THREE.MeshLambertMaterial({ color: 0xe6c36a, emissive: 0x6b5200, emissiveIntensity: 0.3 });
    const weighPost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8), brassMat);
    weighPost.position.y = 2.1;
    weigh.add(weighPost);
    const weighBeam = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.07), brassMat);
    weighBeam.position.y = 2.5;
    weigh.add(weighBeam);
    for (const px of [-0.7, 0.7]) {
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.06, 14), brassMat);
      pan.position.set(px, 2.12, 0);
      weigh.add(pan);
    }
    const WEIGH_ID = '__weighhouse__';
    [weighBody, weighRoof].forEach((m) => {
      m.userData.id = WEIGH_ID;
      pickables.push(m);
    });
    scene.add(weigh);
    pops.push({ o: weigh, delay: 0.3, dur: 0.6, mode: 'uniform', ease: easeBack });
    const distLabels: {
      el: HTMLDivElement;
      pos: THREE.Vector3;
      delay: number;
    }[] = [];

    DISTRICT_ORDER.forEach((districtId, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / DISTRICT_ORDER.length;
      const cx = Math.cos(ang) * RING_RADIUS;
      const cz = Math.sin(ang) * RING_RADIUS;
      const col = vivid(WARD_COLOR_HEX[districtId]);
      const wardDelay = 0.6 + i * 0.24; // Ward muncul satu per satu

      const road = new THREE.Mesh(
        new THREE.BoxGeometry(RING_RADIUS - 6, 0.08, 1.3),
        new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }),
      );
      road.position.set(
        Math.cos(ang) * (RING_RADIUS / 2 + 0.6),
        0.02,
        Math.sin(ang) * (RING_RADIUS / 2 + 0.6),
      );
      road.rotation.y = -ang;
      scene.add(road);
      pops.push({
        o: road,
        delay: wardDelay - 0.1,
        dur: 0.45,
        mode: 'x',
        ease: easeOut,
      });

      const plateCol = col.clone().lerp(new THREE.Color(0xffffff), 0.5); // lantai berwarna
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(8.4, 0.5, 8.4),
        new THREE.MeshLambertMaterial({ color: plateCol }),
      );
      plate.position.set(cx, 0.2, cz);
      plate.rotation.y = -ang;
      scene.add(plate);
      pops.push({
        o: plate,
        delay: wardDelay,
        dur: 0.55,
        mode: 'uniform',
        ease: easeBack,
      });

      // Inlay ubin papan-catur berwarna di atas lantai Ward.
      const tileMap = new THREE.CanvasTexture(tileCanvas(col));
      tileMap.colorSpace = THREE.SRGBColorSpace;
      const inlay = new THREE.Mesh(
        new THREE.BoxGeometry(7.6, 0.06, 7.6),
        new THREE.MeshLambertMaterial({ map: tileMap }),
      );
      inlay.position.set(cx, 0.48, cz);
      inlay.rotation.y = -ang;
      scene.add(inlay);
      pops.push({
        o: inlay,
        delay: wardDelay + 0.05,
        dur: 0.55,
        mode: 'uniform',
        ease: easeBack,
      });

      const rim = new THREE.LineSegments(
        new THREE.EdgesGeometry(plate.geometry),
        new THREE.LineBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.95,
        }),
      );
      rim.position.copy(plate.position);
      rim.rotation.copy(plate.rotation);
      scene.add(rim);
      pops.push({
        o: rim,
        delay: wardDelay,
        dur: 0.55,
        mode: 'uniform',
        ease: easeBack,
      });

      const distLabel = makeLabel(
        'dist',
        WARD_LABEL[districtId],
        WARD_COLOR_HEX[districtId],
      );
      labelsEl.appendChild(distLabel);
      distLabels.push({
        el: distLabel,
        pos: new THREE.Vector3(
          Math.cos(ang) * (RING_RADIUS + 5.4),
          0.4,
          Math.sin(ang) * (RING_RADIUS + 5.4),
        ),
        delay: wardDelay + 0.2,
      });

      const members = agentsRef.current.filter(
        (a) => a.district === districtId,
      );
      members.forEach((agent, k) => {
        const offset = BUILDING_OFFSETS[k];
        if (!offset) return; // lebih dari 4 Wright per Ward -- belum didukung layout ini
        const [ox, oz] = offset;
        const ca = Math.cos(-ang);
        const sa = Math.sin(-ang);
        const x = cx + ox * ca - oz * sa;
        const z = cz + ox * sa + oz * ca;

        const geo = new THREE.BoxGeometry(2.3, 1, 2.3);
        geo.translate(0, 0.5, 0);
        const map = baseMap.clone();
        map.needsUpdate = true;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        const emissiveMap = baseEmissive.clone();
        emissiveMap.needsUpdate = true;
        emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;

        const wallMaterial = new THREE.MeshLambertMaterial({
          color: col.clone().lerp(new THREE.Color(0xffffff), 0.08),
          map,
          emissive: new THREE.Color(0xffffff),
          emissiveMap,
          emissiveIntensity: 0.05,
        });
        const roofMaterial = new THREE.MeshLambertMaterial({
          color: col.clone().lerp(new THREE.Color(0xffffff), 0.25),
        });
        const mesh = new THREE.Mesh(geo, [
          wallMaterial,
          wallMaterial,
          roofMaterial,
          roofMaterial,
          wallMaterial,
          wallMaterial,
        ]);
        mesh.position.set(x, 0.45, z);
        mesh.rotation.y = -ang;
        mesh.userData.id = agent.id;
        scene.add(mesh);
        pickables.push(mesh);

        const beacon = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.42),
          new THREE.MeshLambertMaterial({
            color: col,
            emissive: col,
            emissiveIntensity: 0.6,
          }),
        );
        scene.add(beacon);

        // Taman atap + AC + bendera berwarna Ward (dipindah mengikuti tinggi gedung).
        const roofDeco = new THREE.Group();
        const garden = new THREE.Mesh(
          new THREE.BoxGeometry(1.3, 0.1, 1.3),
          new THREE.MeshLambertMaterial({ color: 0x5ee04a }),
        );
        garden.position.set(-0.35, 0.05, -0.3);
        roofDeco.add(garden);
        [
          [-0.35, -0.3, 0.34],
          [-0.75, 0.0, 0.24],
          [0.0, 0.0, 0.2],
        ].forEach(([bx, bz, bs]) => {
          const bush = new THREE.Mesh(blobGeo, pick2(leafMats));
          bush.position.set(bx, 0.1 + bs * 0.7, bz);
          bush.scale.setScalar(bs);
          roofDeco.add(bush);
        });
        const ac = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.28, 0.4),
          new THREE.MeshLambertMaterial({ color: 0xe6ebf5 }),
        );
        ac.position.set(0.6, 0.14, 0.55);
        roofDeco.add(ac);
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6),
          new THREE.MeshLambertMaterial({ color: 0xcfd6e6 }),
        );
        pole.position.set(0.8, 0.55, -0.8);
        roofDeco.add(pole);
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(0.44, 0.26).translate(0.22, 0, 0),
          new THREE.MeshLambertMaterial({
            color: vivid(WARD_COLOR_HEX[districtId], 1.7, 0.5),
            side: THREE.DoubleSide,
          }),
        );
        flag.position.set(0.8, 0.98, -0.8);
        roofDeco.add(flag);
        roofDeco.visible = false;
        scene.add(roofDeco);

        const label = makeLabel('bld', agent.code);
        labelsEl.appendChild(label);

        const h = heightFor(agent.revenue30d);
        mesh.scale.y = h;
        map.repeat.set(1, Math.max(1, Math.round(h * 0.9)));
        emissiveMap.repeat.copy(map.repeat);
        buildings.set(agent.id, {
          agentId: agent.id,
          district: districtId,
          mesh,
          wallMaterial,
          map,
          emissiveMap,
          beacon,
          roofDeco,
          flag,
          label,
          h,
          target: h,
          phase: Math.random() * 6,
          glow: 0.05,
          status: agent.status,
          revenue: agent.revenue30d,
          delay: wardDelay + 0.3 + k * 0.08,
        });
      });
    });

    // Pepohonan: pohon bulat & cemara low-poly di taman antar-Ward, tepi
    // lempeng rumput, dan sekitar Counting House. Posisi di-reject kalau
    // menabrak lempeng Ward, jalan, aula, atau papan nama Ward.
    const GROUND_Y = -0.2; // permukaan rumput
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const coneGeo = new THREE.ConeGeometry(1, 1, 7);
    coneGeo.translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a5a34 });
    const pineMats = [0x12a85a, 0x22c975].map(
      (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }),
    );
    const blossomMats = [0xff8fb3, 0xff6f91, 0xc58bff, 0xffb347].map(
      (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }),
    );

    const rand = mulberry32(20260928);
    const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

    function buildTree(kind: 'round' | 'pine' | 'blossom', size: number) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      if (kind === 'pine') {
        trunk.scale.set(1, 0.55, 1);
        tree.add(trunk);
        const mat = pick(pineMats);
        (
          [
            [0.45, 0.95, 1.2],
            [1.15, 0.72, 1.0],
            [1.75, 0.48, 0.85],
          ] as const
        ).forEach(([y, r, h]) => {
          const cone = new THREE.Mesh(coneGeo, mat);
          cone.position.y = y;
          cone.scale.set(r, h, r);
          tree.add(cone);
        });
      } else {
        trunk.scale.set(1, 0.95, 1);
        tree.add(trunk);
        const mat = kind === 'blossom' ? pick2(blossomMats) : pick(leafMats);
        const low = new THREE.Mesh(blobGeo, mat);
        low.position.y = 1.4;
        low.scale.set(0.85, 0.75, 0.85);
        tree.add(low);
        const high = new THREE.Mesh(blobGeo, mat);
        high.position.set(0.12, 2.0, -0.05);
        high.scale.set(0.58, 0.52, 0.58);
        tree.add(high);
      }
      tree.scale.setScalar(size);
      return tree;
    }

    const wardAngles = DISTRICT_ORDER.map(
      (_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / DISTRICT_ORDER.length,
    );
    function isBlocked(x: number, z: number) {
      if (Math.hypot(x, z) < 5.2) return true; // Counting House
      if (Math.hypot(x - weigh.position.x, z - weigh.position.z) < 2.4) return true; // Weighhouse
      for (const ang of wardAngles) {
        const dx = Math.cos(ang);
        const dz = Math.sin(ang);
        const along = x * dx + z * dz;
        const across = Math.abs(x * dz - z * dx);
        if (Math.abs(along - RING_RADIUS) < 5.2 && across < 5.2) return true; // lempeng Ward
        if (along > 2.5 && along < RING_RADIUS && across < 2.0) return true; // jalan
        if (
          Math.hypot(
            x - dx * (RING_RADIUS + 5.4),
            z - dz * (RING_RADIUS + 5.4),
          ) < 2.6
        )
          return true; // papan nama Ward
      }
      return false;
    }

    const treeSpots: [number, number][] = [];
    const trees: Tree[] = [];
    const TREE_COUNT = 40;
    for (
      let attempt = 0;
      attempt < 600 && trees.length < TREE_COUNT;
      attempt++
    ) {
      const a = rand() * Math.PI * 2;
      const r = 5.8 + Math.sqrt(rand()) * 15; // 5.8 .. 20.8, tetap di dalam lempeng rumput
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (isBlocked(x, z)) continue;
      if (treeSpots.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 1.9))
        continue;
      treeSpots.push([x, z]);

      const roll = rand();
      const kind = roll < 0.4 ? 'round' : roll < 0.8 ? 'pine' : 'blossom';
      const root = new THREE.Group();
      root.position.set(x, GROUND_Y, z);
      root.rotation.y = rand() * Math.PI * 2;
      root.add(buildTree(kind, 0.85 + rand() * 0.5));
      scene.add(root);
      trees.push({ root, phase: rand() * 6 });
      pops.push({
        o: root,
        delay: 1.3 + rand() * 1.0, // muncul setelah Ward & gedung
        dur: 0.55,
        mode: 'uniform',
        ease: easeBack,
      });
    }

    // ===== Suasana hidup: dekorasi tambahan =====
    // Semua di bawah ini hanya MENAMBAH (orang, mobil, lampu, bunga, kolam,
    // kupu-kupu, awan). Layout Ward, jalan, gedung, dan pohon tidak diubah.
    const decorSpots: [number, number, number][] = [];
    const isFree = (x: number, z: number, r: number, useDecor = true) => {
      if (Math.hypot(x, z) + r > 21) return false;
      if (isBlocked(x, z)) return false;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (isBlocked(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
      }
      if (treeSpots.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < r + 0.9))
        return false;
      if (
        useDecor &&
        decorSpots.some(
          ([dx, dz, dr]) => Math.hypot(dx - x, dz - z) < r + dr + 0.3,
        )
      )
        return false;
      return true;
    };
    function findSpot(r: number, tries = 160): [number, number] | null {
      for (let i = 0; i < tries; i++) {
        const a = rand2() * Math.PI * 2;
        const d = 6 + Math.sqrt(rand2()) * 14.5;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (isFree(x, z, r)) {
          decorSpots.push([x, z, r]);
          return [x, z];
        }
      }
      return null;
    }

    // Statis: tumbuh dari tanah (scale.y) setelah Ward & gedung muncul.
    const decor = new THREE.Group();
    scene.add(decor);

    // Petak rumput dengan hijau berbeda-beda.
    const patchColors = [0x6cec4a, 0x3ed03a, 0xa4f26a, 0x2fc866];
    for (let i = 0; i < 16; i++) {
      const r = 1.2 + rand2() * 1.6;
      const a = rand2() * Math.PI * 2;
      const d = 6 + Math.sqrt(rand2()) * 14;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (!isFree(x, z, r, false)) continue;
      const patch = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, 0.02, 20),
        new THREE.MeshLambertMaterial({ color: pick2(patchColors) }),
      );
      patch.position.set(x, GROUND_Y + 0.01 + i * 0.002, z);
      decor.add(patch);
    }

    // Kolam kecil dengan tepi batu & teratai.
    const pondMats: THREE.MeshLambertMaterial[] = [];
    for (let i = 0; i < 2; i++) {
      const spot = findSpot(1.7);
      if (!spot) continue;
      const [px, pz] = spot;
      const edge = new THREE.Mesh(
        new THREE.CylinderGeometry(1.75, 1.8, 0.1, 28),
        new THREE.MeshLambertMaterial({ color: 0xf3ead2 }),
      );
      edge.position.set(px, GROUND_Y + 0.05, pz);
      decor.add(edge);
      const waterMat = new THREE.MeshLambertMaterial({
        color: 0x3fb8f0,
        emissive: 0x1a78c0,
        emissiveIntensity: 0.3,
      });
      pondMats.push(waterMat);
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 1.5, 0.1, 28),
        waterMat,
      );
      water.position.set(px, GROUND_Y + 0.08, pz);
      decor.add(water);
      for (let k = 0; k < 3; k++) {
        const a = rand2() * Math.PI * 2;
        const dd = 0.3 + rand2() * 0.85;
        const pad = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26, 0.26, 0.03, 10),
          new THREE.MeshLambertMaterial({ color: 0x3fc264 }),
        );
        pad.position.set(
          px + Math.cos(a) * dd,
          GROUND_Y + 0.15,
          pz + Math.sin(a) * dd,
        );
        decor.add(pad);
        if (k < 2) {
          const bud = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.11, 0),
            new THREE.MeshLambertMaterial({
              color: k ? 0xff8fb3 : 0xffffff,
              flatShading: true,
            }),
          );
          bud.position.set(pad.position.x, GROUND_Y + 0.22, pad.position.z);
          decor.add(bud);
        }
      }
    }

    // Semak berbunga warna-warni (InstancedMesh supaya ringan).
    const flowerGeo = new THREE.IcosahedronGeometry(0.11, 0);
    const flowerMat = new THREE.MeshLambertMaterial({ flatShading: true });
    const FLOWER_COLORS = [
      0xff5d8f, 0xffd23a, 0xff8a3d, 0xb46bff, 0xffffff, 0xff4b4b, 0x4dc9ff,
    ].map((c) => new THREE.Color(c));
    const clusters: [number, number][] = [];
    for (let i = 0; i < 24; i++) {
      const s = findSpot(0.75);
      if (s) clusters.push(s);
    }
    const PER_CLUSTER = 7;
    const flowers = new THREE.InstancedMesh(
      flowerGeo,
      flowerMat,
      Math.max(1, clusters.length * PER_CLUSTER),
    );
    const dummy = new THREE.Object3D();
    let fi = 0;
    clusters.forEach(([cx0, cz0]) => {
      const bush = new THREE.Mesh(blobGeo, pick2(leafMats));
      bush.position.set(cx0, GROUND_Y + 0.22, cz0);
      bush.scale.set(0.62, 0.42, 0.62);
      decor.add(bush);
      for (let k = 0; k < PER_CLUSTER; k++) {
        const a = rand2() * Math.PI * 2;
        const dd = 0.12 + rand2() * 0.42;
        dummy.position.set(
          cx0 + Math.cos(a) * dd,
          GROUND_Y + 0.3 + (0.5 - dd) * 0.35 + rand2() * 0.06,
          cz0 + Math.sin(a) * dd,
        );
        dummy.scale.setScalar(0.85 + rand2() * 0.4);
        dummy.updateMatrix();
        flowers.setMatrixAt(fi, dummy.matrix);
        flowers.setColorAt(fi, pick2(FLOWER_COLORS));
        fi++;
      }
    });
    flowers.count = fi;
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    decor.add(flowers);

    // Semak polos tambahan.
    for (let i = 0; i < 14; i++) {
      const s = findSpot(0.5);
      if (!s) continue;
      const bush = new THREE.Mesh(blobGeo, pick2(leafMats));
      bush.position.set(s[0], GROUND_Y + 0.2, s[1]);
      bush.scale.set(0.5 + rand2() * 0.25, 0.4, 0.5 + rand2() * 0.25);
      decor.add(bush);
    }

    // Lampu jalan di dua sisi tiap jalan menuju Ward.
    const poleGeo = new THREE.CylinderGeometry(0.045, 0.06, 1.5, 6);
    poleGeo.translate(0, 0.75, 0);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x4a4f6a });
    const bulbGeo = new THREE.SphereGeometry(0.17, 10, 8);
    const bulbMat = new THREE.MeshLambertMaterial({
      color: 0xfff2b0,
      emissive: 0xffd84a,
      emissiveIntensity: 1,
    });
    wardAngles.forEach((ang) => {
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      [3.8, 6.6].forEach((along) => {
        [-1, 1].forEach((side) => {
          const across = side * 0.98;
          const lx = dx * along - dz * across;
          const lz = dz * along + dx * across;
          const pole = new THREE.Mesh(poleGeo, poleMat);
          pole.position.set(lx, GROUND_Y, lz);
          decor.add(pole);
          const bulb = new THREE.Mesh(bulbGeo, bulbMat);
          bulb.position.set(lx, GROUND_Y + 1.6, lz);
          decor.add(bulb);
        });
      });
    });

    // Orang-orang kecil berbaju warna-warni.
    const SKIN = [0xffd7b5, 0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69].map(
      (c) => new THREE.MeshLambertMaterial({ color: c }),
    );
    const HAIR = [0x2b2118, 0x5a3825, 0xd9a441, 0x1c1c28, 0xa4482c].map(
      (c) => new THREE.MeshLambertMaterial({ color: c }),
    );
    const SHIRTS = [
      0xff5d8f, 0xffb020, 0x3ec7e0, 0x8f6bff, 0x4cd07d, 0xff7a45, 0x3f78ff,
      0xff4b4b,
    ].map((c) => new THREE.MeshLambertMaterial({ color: c }));
    const PANTS = [0x2b3257, 0x3a4a7a, 0x5a4636, 0x4a4f6a].map(
      (c) => new THREE.MeshLambertMaterial({ color: c }),
    );
    const torsoGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.34, 8);
    torsoGeo.translate(0, 0.37, 0);
    const headGeo = new THREE.SphereGeometry(0.1, 10, 8);
    const hairGeo = new THREE.SphereGeometry(0.105, 10, 8);
    const legGeo = new THREE.BoxGeometry(0.07, 0.2, 0.07);
    legGeo.translate(0, -0.1, 0);

    interface Person {
      root: THREE.Group;
      legL: THREE.Group;
      legR: THREE.Group;
    }
    function makePerson(): Person {
      const root = new THREE.Group();
      const inner = new THREE.Group();
      root.add(inner);
      const pants = pick2(PANTS);
      const mk = (x: number) => {
        const g = new THREE.Group();
        g.position.set(x, 0.2, 0);
        g.add(new THREE.Mesh(legGeo, pants));
        inner.add(g);
        return g;
      };
      const legL = mk(-0.05);
      const legR = mk(0.05);
      inner.add(new THREE.Mesh(torsoGeo, pick2(SHIRTS)));
      const head = new THREE.Mesh(headGeo, pick2(SKIN));
      head.position.y = 0.65;
      inner.add(head);
      const hair = new THREE.Mesh(hairGeo, pick2(HAIR));
      hair.position.set(0, 0.68, -0.02);
      hair.scale.set(1, 0.7, 1);
      inner.add(hair);
      inner.scale.setScalar(1.15);
      root.visible = false;
      scene.add(root);
      return { root, legL, legR };
    }
    function stride(p: Person, t: number, speed: number, ph: number) {
      const s = Math.sin(t * speed * 9 + ph);
      p.legL.rotation.x = s * 0.7;
      p.legR.rotation.x = -s * 0.7;
      return Math.abs(s) * 0.035; // naik-turun kecil saat melangkah
    }

    type Mover = (
      t: number,
      dt: number,
      grow: (delay: number, dur: number, ease: (k: number) => number) => number,
    ) => void;
    const movers: Mover[] = [];

    // Pejalan kaki di tepi jalan (dua arah) menuju tiap Ward.
    wardAngles.forEach((ang, wi) => {
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      for (let k = 0; k < 3; k++) {
        const person = makePerson();
        let along = 3.4 + rand2() * 5.2;
        let dir = (k % 2 === 0 ? 1 : -1) as 1 | -1;
        let lat = dir * 0.47;
        const speed = 0.55 + rand2() * 0.4;
        const ph = rand2() * 6;
        const delay = 1.7 + wi * 0.1 + k * 0.15;
        movers.push((t, dt, grow) => {
          along += dir * speed * dt;
          if (along > 8.8) {
            along = 8.8;
            dir = -1;
          } else if (along < 3.3) {
            along = 3.3;
            dir = 1;
          }
          lat += (dir * 0.47 - lat) * Math.min(1, dt * 3);
          const bob = stride(person, t, dt > 0 ? speed : 0, ph);
          person.root.position.set(
            dx * along - dz * lat,
            0.06 + bob,
            dz * along + dx * lat,
          );
          person.root.rotation.y = Math.atan2(dx * dir, dz * dir);
          const e = grow(delay, 0.4, easeBack);
          person.root.visible = e > 0.001;
          person.root.scale.setScalar(Math.max(e, 0.001));
        });
      }
    });

    // Pejalan yang berkeliling di plaza Counting House.
    for (let k = 0; k < 7; k++) {
      const person = makePerson();
      let a = rand2() * Math.PI * 2;
      const sgn = k % 2 === 0 ? 1 : -1;
      const rad = 4.35 + rand2() * 0.55;
      const speed = 0.5 + rand2() * 0.3;
      const ph = rand2() * 6;
      const delay = 1.9 + k * 0.1;
      movers.push((t, dt, grow) => {
        a += (sgn * speed * dt) / rad;
        const bob = stride(person, t, dt > 0 ? speed : 0, ph);
        person.root.position.set(
          Math.cos(a) * rad,
          0.06 + bob,
          Math.sin(a) * rad,
        );
        person.root.rotation.y = Math.atan2(
          -Math.sin(a) * sgn,
          Math.cos(a) * sgn,
        );
        const e = grow(delay, 0.4, easeBack);
        person.root.visible = e > 0.001;
        person.root.scale.setScalar(Math.max(e, 0.001));
      });
    }

    // Pejalan santai di taman.
    for (let k = 0; k < 6; k++) {
      let seg: [number, number, number, number] | null = null;
      for (let i = 0; i < 80 && !seg; i++) {
        const a = rand2() * Math.PI * 2;
        const d = 6 + Math.sqrt(rand2()) * 13;
        const x0 = Math.cos(a) * d;
        const z0 = Math.sin(a) * d;
        const wa = rand2() * Math.PI * 2;
        const len = 3 + rand2() * 3;
        const x1 = x0 + Math.cos(wa) * len;
        const z1 = z0 + Math.sin(wa) * len;
        if (
          isFree(x0, z0, 0.3) &&
          isFree(x1, z1, 0.3) &&
          isFree((x0 + x1) / 2, (z0 + z1) / 2, 0.3)
        )
          seg = [x0, z0, x1, z1];
      }
      if (!seg) continue;
      const [x0, z0, x1, z1] = seg;
      const person = makePerson();
      const total = Math.hypot(x1 - x0, z1 - z0);
      let u = rand2();
      let dir = 1;
      const speed = 0.4 + rand2() * 0.25;
      const ph = rand2() * 6;
      const delay = 2.2 + k * 0.12;
      movers.push((t, dt, grow) => {
        u += (dir * speed * dt) / total;
        if (u > 1) {
          u = 1;
          dir = -1;
        } else if (u < 0) {
          u = 0;
          dir = 1;
        }
        const bob = stride(person, t, dt > 0 ? speed : 0, ph);
        person.root.position.set(
          x0 + (x1 - x0) * u,
          GROUND_Y + bob,
          z0 + (z1 - z0) * u,
        );
        person.root.rotation.y = Math.atan2((x1 - x0) * dir, (z1 - z0) * dir);
        const e = grow(delay, 0.4, easeBack);
        person.root.visible = e > 0.001;
        person.root.scale.setScalar(Math.max(e, 0.001));
      });
    }

    // Mobil kecil warna-warni bolak-balik di jalan menuju tiap Ward.
    const CAR_COLORS = [0xff5a5f, 0xffc233, 0x3ec7e0, 0x8f6bff, 0x4cd07d];
    const wheelGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x2b2f45 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0xcfe8ff });
    const lightMat = new THREE.MeshLambertMaterial({
      color: 0xfff2b0,
      emissive: 0xffd84a,
      emissiveIntensity: 0.9,
    });
    wardAngles.forEach((ang, wi) => {
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      const car = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({
        color: CAR_COLORS[wi % CAR_COLORS.length],
      });
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.16, 0.8),
        bodyMat,
      );
      body.position.y = 0.17;
      car.add(body);
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.14, 0.4),
        glassMat,
      );
      cabin.position.set(0, 0.31, -0.05);
      car.add(cabin);
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.03, 0.42),
        bodyMat,
      );
      roof.position.set(0, 0.395, -0.05);
      car.add(roof);
      [
        [-0.23, 0.26],
        [0.23, 0.26],
        [-0.23, -0.26],
        [0.23, -0.26],
      ].forEach(([wx, wz]) => {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(wx, 0.09, wz);
        car.add(w);
      });
      [-0.12, 0.12].forEach((lx) => {
        const l = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 0.05, 0.03),
          lightMat,
        );
        l.position.set(lx, 0.18, 0.4);
        car.add(l);
      });
      car.visible = false;
      scene.add(car);

      let along = 3.6 + rand2() * 4.5;
      let dir = (wi % 2 === 0 ? 1 : -1) as 1 | -1;
      let pause = 0;
      const delay = 2.0 + wi * 0.12;
      movers.push((_t, dt, grow) => {
        if (pause > 0) pause -= dt;
        else {
          along += dir * 1.3 * dt;
          if (along > 8.7 || along < 3.5) {
            along = Math.min(8.7, Math.max(3.5, along));
            dir = (dir * -1) as 1 | -1;
            pause = 1.2 + rand2();
          }
        }
        car.position.set(dx * along, 0.06, dz * along);
        car.rotation.y = Math.atan2(dx * dir, dz * dir);
        const e = grow(delay, 0.4, easeBack);
        car.visible = e > 0.001;
        car.scale.setScalar(Math.max(e, 0.001));
      });
    });

    // Kupu-kupu beterbangan di atas semak berbunga.
    const wingGeo = new THREE.PlaneGeometry(0.2, 0.15).translate(0.1, 0, 0);
    const BUTTERFLY = [0xff8a3d, 0xffd23a, 0xff6f91, 0x5ab8ff];
    const butterflyCount = Math.min(9, clusters.length);
    for (let k = 0; k < butterflyCount; k++) {
      const [bx, bz] = clusters[k];
      const mat = new THREE.MeshLambertMaterial({
        color: BUTTERFLY[k % BUTTERFLY.length],
        emissive: BUTTERFLY[k % BUTTERFLY.length],
        emissiveIntensity: 0.35,
        side: THREE.DoubleSide,
      });
      const bf = new THREE.Group();
      const wl = new THREE.Mesh(wingGeo, mat);
      const wr = new THREE.Mesh(wingGeo, mat);
      wr.rotation.y = Math.PI;
      bf.add(wl, wr);
      bf.visible = false;
      scene.add(bf);
      const ph = rand2() * 6;
      const rr = 0.7 + rand2() * 0.9;
      const sp = 0.6 + rand2() * 0.6;
      movers.push((t, dt, grow) => {
        const a = t * sp + ph;
        bf.position.set(
          bx + Math.cos(a) * rr,
          GROUND_Y + 1.0 + Math.sin(t * 2.3 + ph) * 0.25,
          bz + Math.sin(a * 1.3) * rr,
        );
        bf.rotation.y = -a;
        const flap = dt > 0 ? Math.sin(t * 22 + ph) * 0.9 : 0.3;
        wl.rotation.z = flap;
        wr.rotation.z = -flap;
        bf.visible = grow(2.4, 0.3, easeOut) > 0.5;
      });
    }

    // Awan putih pelan-pelan melayang mengitari pulau.
    const cloudMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0xbfd8f5,
      emissiveIntensity: 0.35,
    });
    const cloudGeo = new THREE.SphereGeometry(1, 12, 8);
    for (let k = 0; k < 6; k++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rand2() * 3);
      for (let i = 0; i < puffs; i++) {
        const m = new THREE.Mesh(cloudGeo, cloudMat);
        const sc = 1.0 + rand2() * 1.1;
        m.scale.set(sc * 1.4, sc * 0.7, sc);
        m.position.set(
          i * 1.5 - puffs * 0.7,
          rand2() * 0.4,
          (rand2() - 0.5) * 1.2,
        );
        cloud.add(m);
      }
      const base = (k / 6) * Math.PI * 2 + rand2();
      const dist = 26 + rand2() * 6;
      const y = 0.5 + rand2() * 2.5;
      const sp = 0.012 + rand2() * 0.012;
      cloud.position.y = y;
      scene.add(cloud);
      movers.push((t) => {
        const a = base + t * sp;
        cloud.position.x = Math.cos(a) * dist;
        cloud.position.z = Math.sin(a) * dist;
      });
    }

    const hallLabel = makeLabel('hall', 'Counting House · Tithe');
    labelsEl.appendChild(hallLabel);
    const weighLabel = makeLabel('hall', 'Weighhouse');
    labelsEl.appendChild(weighLabel);

    // Sorotan emas: gedung yang sedang di-hover (di prototipe: gedung terpilih).
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(2.5, 1, 2.5).translate(0, 0.5, 0),
      ),
      new THREE.LineBasicMaterial({ color: 0x2b3257 }),
    );
    outline.visible = false;
    scene.add(outline);

    // Koin: 3 terbang ke Counting House (tithe), sisanya melayang naik (holder).
    const coinGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.1, 18);
    coinGeo.rotateX(Math.PI / 2);
    const coinMat = new THREE.MeshLambertMaterial({
      color: 0xf7c93c,
      emissive: 0xb07a00,
      emissiveIntensity: 0.55,
    });
    const flying: FlyingCoin[] = [];
    function spawnCoins(b: Building) {
      const from = b.mesh.position.clone();
      from.y += b.h + 0.8;
      const hallTo = new THREE.Vector3(0, 5.6, 0);
      const n = reduceMotion ? 1 : 7;
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(coinGeo, coinMat);
        m.position.copy(from);
        m.visible = false;
        scene.add(m);
        const toHall = i < 3;
        const to = toHall
          ? hallTo.clone()
          : from
              .clone()
              .add(
                new THREE.Vector3(
                  (Math.random() - 0.5) * 4,
                  4 + Math.random() * 2,
                  (Math.random() - 0.5) * 4,
                ),
              );
        flying.push({
          m,
          from: from.clone(),
          to,
          t: -i * 0.09,
          dur: 1.3,
          fade: !toHall,
        });
      }
    }

    // Interaksi: drag untuk orbit (dengan inersia), scroll untuk zoom, klik gedung -> profil.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let dragState: {
      x: number;
      y: number;
      theta: number;
      moved: number;
      lastX: number;
      lastT: number;
    } | null = null;
    let hoverId: string | null = null;

    function hit(e: PointerEvent): string | null {
      const r = cv.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const h = ray.intersectObjects(pickables)[0];
      return h ? ((h.object as THREE.Mesh).userData.id as string) : null;
    }

    function onPointerDown(e: PointerEvent) {
      dragState = {
        x: e.clientX,
        y: e.clientY,
        theta,
        moved: 0,
        lastX: e.clientX,
        lastT: performance.now(),
      };
      thetaVel = 0;
      cv.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (dragState) {
        const dx = e.clientX - dragState.x;
        dragState.moved = Math.max(
          dragState.moved,
          Math.abs(dx) + Math.abs(e.clientY - dragState.y),
        );
        theta = dragState.theta - dx * DRAG_RAD_PER_PX;
        const now = performance.now();
        const inst =
          (-(e.clientX - dragState.lastX) * DRAG_RAD_PER_PX) /
          Math.max((now - dragState.lastT) / 1000, 0.001);
        thetaVel = 0.6 * inst + 0.4 * thetaVel;
        dragState.lastX = e.clientX;
        dragState.lastT = now;
        if (dragState.moved >= 6) cv.style.cursor = 'grabbing';
        placeCam();
        return;
      }
      hoverId = hit(e);
      cv.style.cursor = hoverId ? 'pointer' : 'grab';
    }
    function endDrag(e: PointerEvent, allowClick: boolean) {
      if (!dragState) return;
      const wasClick = dragState.moved < 6;
      const stale = performance.now() - dragState.lastT > 80;
      if (wasClick || stale || reduceMotion) thetaVel = 0;
      dragState = null;
      if (allowClick && wasClick) {
        const id = hit(e);
        if (id === WEIGH_ID) {
          router.push('/weighhouse');
        } else if (id) {
          if (onSelectRef.current) onSelectRef.current(id);
          else router.push(`/agents/${id}`);
        }
      }
      hoverId = hit(e);
      cv.style.cursor = hoverId ? 'pointer' : 'grab';
    }
    const onPointerUp = (e: PointerEvent) => endDrag(e, true);
    const onPointerCancel = (e: PointerEvent) => endDrag(e, false);
    function onPointerLeave() {
      if (!dragState) hoverId = null;
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      zoom = Math.min(2.6, Math.max(0.6, zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }

    cv.style.cursor = 'grab';
    cv.addEventListener('pointerdown', onPointerDown);
    cv.addEventListener('pointermove', onPointerMove);
    cv.addEventListener('pointerup', onPointerUp);
    cv.addEventListener('pointercancel', onPointerCancel);
    cv.addEventListener('pointerleave', onPointerLeave);
    cv.addEventListener('wheel', onWheel, { passive: false });

    // Tombol ‹ › (dipanggil dari JSX di bawah): meluncur tepat ~45 derajat.
    nudgeRef.current = (dir) => {
      if (reduceMotion) {
        theta -= dir * NUDGE_RAD;
        placeCam();
      } else {
        thetaVel = (-dir * NUDGE_RAD) / INERTIA_S;
      }
    };

    const v3 = new THREE.Vector3();
    function project(pos: THREE.Vector3, el: HTMLDivElement) {
      v3.copy(pos).project(camera);
      el.style.left = ((v3.x + 1) / 2) * stage!.clientWidth + 'px';
      el.style.top = ((1 - v3.y) / 2) * stage!.clientHeight + 'px';
    }

    // --- Siang / malam ----------------------------------------------------
    const HEMI_SKY = [new THREE.Color(0x3f56a0), new THREE.Color(0xe4f1ff)];
    const HEMI_GND = [new THREE.Color(0x1f3d33), new THREE.Color(0x7cf04f)];
    const SUN_COL = [new THREE.Color(0x9db4ff), new THREE.Color(0xffe7b8)]; // bulan / matahari
    const DUSK_COL = new THREE.Color(0xff9a5a);
    const FILL_COL = [new THREE.Color(0x5a6cc0), new THREE.Color(0x9cbcff)];
    const CLOUD_COL = [new THREE.Color(0x8d9acb), new THREE.Color(0xffffff)];
    const CLOUD_EMI = [new THREE.Color(0x2b3866), new THREE.Color(0xbfd8f5)];
    const UI_BG = [new THREE.Color(0x141a36), new THREE.Color(0xffffff)];
    const UI_FG = [new THREE.Color(0xc9d0f2), new THREE.Color(0x4a516d)];
    const tmpA = new THREE.Color();
    const tmpB = new THREE.Color();

    const clockTarget = () =>
      modeRef.current === 'day'
        ? 1
        : modeRef.current === 'night'
          ? 0
          : daylightAt(new Date());
    let day = clockTarget();
    let appliedDay = -1;
    let lastClock = performance.now();
    let target = day;

    function applyDaylight(d: number) {
      hemi.color.copy(HEMI_SKY[0]).lerp(HEMI_SKY[1], d);
      hemi.groundColor.copy(HEMI_GND[0]).lerp(HEMI_GND[1], d);
      hemi.intensity = (0.5 + 0.16 * d) * Math.PI;
      const warm = 1 - Math.abs(2 * d - 1); // puncak di fajar / senja
      sun.color
        .copy(SUN_COL[0])
        .lerp(SUN_COL[1], d)
        .lerp(DUSK_COL, warm * 0.55);
      sun.intensity = (0.38 + 0.47 * d) * Math.PI;
      fill.color.copy(FILL_COL[0]).lerp(FILL_COL[1], d);
      fill.intensity = (0.2 + 0.1 * d) * Math.PI;
      cloudMat.color.copy(CLOUD_COL[0]).lerp(CLOUD_COL[1], d);
      cloudMat.emissive.copy(CLOUD_EMI[0]).lerp(CLOUD_EMI[1], d);

      const st = stage!.style;
      st.setProperty('--sky-in', skyColor(d, 0, tmpA).getStyle());
      st.setProperty('--sky-out', skyColor(d, 1, tmpB).getStyle());
      st.setProperty('--night', String(1 - d));
      tmpA.copy(UI_BG[0]).lerp(UI_BG[1], d);
      st.setProperty('--ui-bg', rgbaOf(tmpA, 0.8));
      st.setProperty('--ui-btn', rgbaOf(tmpA, 0.92));
      st.setProperty(
        '--ui-fg',
        tmpB.copy(UI_FG[0]).lerp(UI_FG[1], d).getStyle(),
      );

      // Label "Counting House" terbaca di kedua tema.
      const isNight = d < 0.5;
      hallLabel.style.color = isNight ? '#ffd98a' : '#a0741a';
      weighLabel.style.color = isNight ? '#b9c2f0' : '#56608a';
      hallLabel.style.textShadow = isNight
        ? '0 0 6px rgba(10,14,42,.95), 0 1px 0 rgba(10,14,42,.95)'
        : '0 0 6px #fff, 0 1px 0 #fff';
    }
    applyDaylight(day);
    appliedDay = day;

    const t0 = performance.now() / 1000;
    let lastTime = performance.now();
    let raf = 0;
    const labelPos = new THREE.Vector3();

    function frame(now: number) {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const t = now / 1000;
      const since = t - t0;
      const grow = (delay: number, dur: number, ease: (k: number) => number) =>
        reduceMotion ? 1 : ease(clamp01((since - delay) / dur));

      // Jam dicek tiap beberapa detik saja; perpindahan siang <-> malam dibuat
      // mulus (langsung loncat kalau user memilih reduced motion).
      if (now - lastClock > 5000 || modeChanged.current) {
        lastClock = now;
        modeChanged.current = false;
        target = clockTarget();
      }
      day = reduceMotion
        ? target
        : day + (target - day) * Math.min(1, dt * 1.6);
      if (Math.abs(day - target) < 0.002) day = target;
      if (Math.abs(day - appliedDay) > 0.001) {
        applyDaylight(day);
        appliedDay = day;
      }
      const night = 1 - day;

      if (!dragState && Math.abs(thetaVel) > 0.01) {
        theta += thetaVel * dt;
        thetaVel *= Math.exp(-dt / INERTIA_S);
        placeCam();
      }

      // Data terbaru tiap frame -- perubahan status/revenue dari Realtime
      // langsung terlihat tanpa membangun ulang scene.
      const liveById = new Map(agentsRef.current.map((a) => [a.id, a]));

      // Lantai, jalan, dan aula muncul bertahap.
      pops.forEach((p) => {
        const e =
          p.ease === easeBack
            ? grow(p.delay, p.dur, easeBack)
            : grow(p.delay, p.dur, easeOut);
        const s = Math.max(e, 0.001);
        p.o.visible = e > 0.001;
        if (p.mode === 'x') p.o.scale.set(s, 1, 1);
        else p.o.scale.setScalar(s);
      });

      buildings.forEach((b) => {
        const live = liveById.get(b.agentId);
        if (live) {
          b.status = live.status;
          b.target = heightFor(live.revenue30d);
          if (live.revenue30d > b.revenue + 0.5) spawnCoins(b); // wage cair -> koin terbang
          b.revenue = live.revenue30d;
        }

        if (Math.abs(b.target - b.h) > 0.005) {
          b.h += (b.target - b.h) * Math.min(1, dt * 3);
          b.map.repeat.set(1, Math.max(1, Math.round(b.h * 0.9)));
          b.emissiveMap.repeat.copy(b.map.repeat);
        }

        const rise = grow(b.delay, 0.7, easeOut); // gedung "tumbuh" dari tanah
        const hovered = hoverId === b.agentId;
        b.mesh.visible = rise > 0.001;
        b.mesh.scale.set(
          hovered ? 1.05 : 1,
          Math.max(b.h * rise, 0.001),
          hovered ? 1.05 : 1,
        );

        // Malam: semua jendela menyala hangat; yang sedang bekerja paling terang.
        const want =
          b.status === 'working'
            ? 0.95 +
              night * 0.3 +
              (reduceMotion ? 0 : Math.sin(t * 3 + b.phase) * 0.15)
            : b.status === 'review'
              ? 0.6 + night * 0.35
              : 0.05 + night * 0.55;
        b.glow += (want - b.glow) * Math.min(1, dt * 4);
        b.wallMaterial.emissiveIntensity = b.glow;

        const top = b.mesh.position.y + b.h * rise;
        const beaconPop = grow(b.delay + 0.5, 0.4, easeBack);
        b.beacon.visible = b.status !== 'idle' && beaconPop > 0.001;
        b.beacon.scale.setScalar(Math.max(beaconPop, 0.001));
        if (b.status === 'review') {
          b.beacon.material.color.set(0xffa726);
          b.beacon.material.emissive.set(0xffa726);
        } else {
          const c = vivid(WARD_COLOR_HEX[b.district]);
          b.beacon.material.color.copy(c);
          b.beacon.material.emissive.copy(c);
        }
        b.beacon.position.set(
          b.mesh.position.x,
          top +
            0.9 +
            (reduceMotion
              ? 0
              : Math.sin(t * (b.status === 'review' ? 4 : 2) + b.phase) * 0.2),
          b.mesh.position.z,
        );
        b.beacon.rotation.y += reduceMotion ? 0 : dt * 1.5;

        labelPos.set(
          b.mesh.position.x,
          top + (b.status === 'idle' ? 0.6 : 1.9),
          b.mesh.position.z,
        );
        project(labelPos, b.label);
        b.label.style.opacity = String(grow(b.delay + 0.35, 0.35, easeOut));
        highlightLabel(b.label, hovered || selectedRef.current === b.agentId);

        b.roofDeco.visible = rise > 0.98;
        b.roofDeco.position.set(b.mesh.position.x, top, b.mesh.position.z);
        b.roofDeco.rotation.y = b.mesh.rotation.y;
        b.flag.rotation.y = reduceMotion ? 0 : Math.sin(t * 4 + b.phase) * 0.35;
      });

      const focusId = hoverId ?? selectedRef.current;
      const hb = focusId ? buildings.get(focusId) : undefined;
      outline.visible = !!hb;
      if (hb) {
        outline.position.copy(hb.mesh.position);
        outline.rotation.copy(hb.mesh.rotation);
        outline.scale.set(1, hb.mesh.scale.y, 1);
      }

      for (let i = flying.length - 1; i >= 0; i--) {
        const f = flying[i];
        f.t += dt / f.dur;
        const k = Math.max(0, Math.min(1, f.t));
        f.m.position.lerpVectors(f.from, f.to, k);
        f.m.position.y += Math.sin(k * Math.PI) * 3;
        f.m.rotation.y += dt * 8;
        f.m.visible = f.t > 0;
        if (f.fade) f.m.scale.setScalar(1 - k * 0.8);
        if (f.t >= 1) {
          scene.remove(f.m);
          flying.splice(i, 1);
        }
      }

      if (!reduceMotion) {
        trees.forEach((tr) => {
          tr.root.rotation.z = Math.sin(t * 1.1 + tr.phase) * 0.035; // goyang tipis
        });
      }

      hallCap.rotation.y += reduceMotion ? 0 : dt * 0.3;
      halo.position.y = 4.3 + (reduceMotion ? 0 : Math.sin(t * 1.2) * 0.12);

      // Dekorasi statis tumbuh dari tanah; air kolam berkilau.
      decor.scale.y = Math.max(grow(1.4, 0.7, easeOut), 0.001);
      decor.visible = since > 1.4 || reduceMotion;
      pondMats.forEach((m, i) => {
        m.emissiveIntensity =
          0.3 + (reduceMotion ? 0 : Math.sin(t * 2 + i) * 0.1);
      });
      const mdt = reduceMotion ? 0 : dt;
      movers.forEach((mv) => mv(t, mdt, grow));
      distLabels.forEach((l) => {
        project(l.pos, l.el);
        l.el.style.opacity = String(grow(l.delay, 0.4, easeOut));
      });
      labelPos.set(0, 6.4, 0);
      project(labelPos, hallLabel);
      hallLabel.style.opacity = String(grow(0.6, 0.4, easeOut));

      // Weighhouse: kilau jendela = Work Ratio 24j (0% -> redup, >=25% -> terang penuh).
      const wr = workRatioRef.current;
      const weighGlow = wr == null ? 0.1 : 0.1 + Math.min(Math.max(wr, 0) / 25, 1) * 1.1;
      weighWinMat.emissiveIntensity = weighGlow;
      labelPos.set(weigh.position.x, 3.3, weigh.position.z);
      project(labelPos, weighLabel);
      weighLabel.style.opacity = String(grow(0.8, 0.4, easeOut));

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    placeCam();
    resize();
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      nudgeRef.current = null;
      cv.removeEventListener('pointerdown', onPointerDown);
      cv.removeEventListener('pointermove', onPointerMove);
      cv.removeEventListener('pointerup', onPointerUp);
      cv.removeEventListener('pointercancel', onPointerCancel);
      cv.removeEventListener('pointerleave', onPointerLeave);
      cv.removeEventListener('wheel', onWheel);

      // Bersihkan semua geometri, material, dan tekstur (termasuk koin yang masih terbang).
      scene.traverse((o) => {
        const obj = o as THREE.Mesh;
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material)
          ? obj.material
          : obj.material
            ? [obj.material]
            : [];
        mats.forEach((m) => {
          const mat = m as THREE.MeshLambertMaterial;
          mat.map?.dispose();
          mat.emissiveMap?.dispose();
          mat.dispose();
        });
      });
      trunkGeo.dispose();
      blobGeo.dispose();
      coneGeo.dispose();
      coinGeo.dispose();
      coinMat.dispose();
      baseMap.dispose();
      baseEmissive.dispose();
      buildings.forEach((b) => b.label.remove());
      distLabels.forEach((l) => l.el.remove());
      hallLabel.remove();
      weighLabel.remove();
      renderer.dispose();
      cv.remove();
    };
  }, [router]);

  return (
    <div
      ref={stageRef}
      className="relative h-full min-h-[420px] w-full overflow-hidden"
      style={{
        background:
          'radial-gradient(120% 90% at 50% 40%, var(--sky-in, #fff3d6) 0%, var(--sky-out, #a9d8fb) 78%)',
      }}
    >
      {/* Bintang & bulan: di belakang canvas (canvas transparan), muncul saat malam. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: STARS_BG, opacity: 'var(--night, 0)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[16%] top-[12%] h-9 w-9 rounded-full"
        style={{
          opacity: 'var(--night, 0)',
          background:
            'radial-gradient(circle at 35% 35%, #fffdf0, #e6e2c8 70%)',
          boxShadow: '0 0 18px 6px rgba(230,236,255,.35)',
        }}
      />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0" />

      <div
        className="pointer-events-none absolute left-3 top-2.5 z-10 flex max-w-[70%] flex-wrap gap-x-2.5 gap-y-1 rounded-xl px-2.5 py-1.5 text-[11px] font-medium shadow-sm"
        style={{
          background: 'var(--ui-bg, rgba(255,255,255,.8))',
          color: 'var(--ui-fg, #4a516d)',
        }}
      >
        {DISTRICT_ORDER.map((d) => (
          <span key={d} className="inline-flex items-center gap-1.5">
            <i
              className="inline-block h-2 w-2 flex-none rounded-full"
              style={{ background: vivid(WARD_COLOR_HEX[d]).getStyle() }}
            />
            {WARD_LABEL[d]}
          </span>
        ))}
      </div>

      <div className="absolute right-3 top-2 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={() =>
            setMode((m) =>
              m === 'auto' ? 'day' : m === 'day' ? 'night' : 'auto',
            )
          }
          aria-label={`Time of day: ${mode}. Click to change`}
          title={
            mode === 'auto'
              ? 'Time of day: auto (follows your local time)'
              : `Time of day: ${mode} (click to change)`
          }
          className="h-6 min-w-6 rounded-full px-1.5 text-[12px] leading-none shadow-sm transition hover:brightness-110"
          style={{
            background: 'var(--ui-btn, rgba(255,255,255,.9))',
            color: 'var(--ui-fg, #4a516d)',
          }}
        >
          {mode === 'auto' ? 'Auto' : mode === 'day' ? '☀' : '☾'}
        </button>
        {([-1, 1] as const).map((dir) => (
          <button
            key={dir}
            type="button"
            onClick={() => nudgeRef.current?.(dir)}
            aria-label={dir === 1 ? 'Rotate right' : 'Rotate left'}
            className="h-6 w-6 rounded-full text-[14px] leading-none shadow-sm transition hover:brightness-110"
            style={{
              background: 'var(--ui-btn, rgba(255,255,255,.9))',
              color: 'var(--ui-fg, #4a516d)',
            }}
          >
            {dir === 1 ? '›' : '‹'}
          </button>
        ))}
      </div>
    </div>
  );
}
