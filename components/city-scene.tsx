'use client';

import { useEffect, useRef } from 'react';
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
  ticker: string;
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
const heightFor = (revenue30d: number) => 1.2 + revenue30d / 1500;

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

function windowCanvas(emissive: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = emissive ? '#000' : '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = emissive ? '#fff' : '#3f78c8';
  [
    [8, 10],
    [36, 10],
    [8, 38],
    [36, 38],
  ].forEach(([x, y]) => g.fillRect(x, y, 20, 16));
  return c;
}

// Label HTML di atas canvas. Gaya di-inline (bukan kelas Tailwind) karena
// elemennya dibuat lewat DOM API di luar React, jadi tidak ikut discan Tailwind.
// Palet terang: pil putih untuk ticker, papan berwarna Ward untuk nama Ward.
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

export function CityScene({ agents }: { agents: CityAgent[] }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const nudgeRef = useRef<((dir: 1 | -1) => void) | null>(null);
  const router = useRouter();

  // Data terbaru selalu lewat ref supaya loop animasi (di luar siklus render
  // React) tidak memegang closure data basi.
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

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
    scene.add(new THREE.HemisphereLight(0xdcecff, 0x8fd06a, 0.55 * Math.PI));
    const sun = new THREE.DirectionalLight(0xffe7b8, 0.85 * Math.PI);
    sun.position.set(20, 40, 10);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9cbcff, 0.3 * Math.PI);
    fill.position.set(-20, 15, -20);
    scene.add(fill);

    const ground = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 0.6, 64), [
      new THREE.MeshLambertMaterial({ color: 0xc8b48a }), // sisi: lempeng tanah
      new THREE.MeshLambertMaterial({ color: 0x5cc24a }), // atas: rumput segar
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

    const buildings = new Map<string, Building>();
    const pickables: THREE.Mesh[] = [];
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
          emissive: new THREE.Color(0xffd58a),
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

        const label = makeLabel('bld', '$' + agent.ticker);
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
    const blobGeo = new THREE.IcosahedronGeometry(1, 0);
    const coneGeo = new THREE.ConeGeometry(1, 1, 7);
    coneGeo.translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a5a34 });
    const leafMats = [0x3fb84a, 0x55c83f, 0x2fae62, 0x74d24a].map(
      (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }),
    );
    const pineMats = [0x1f9a55, 0x2fae68].map(
      (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true }),
    );
    const blossomMat = new THREE.MeshLambertMaterial({
      color: 0xff8fb3,
      flatShading: true,
    });

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
        const mat = kind === 'blossom' ? blossomMat : pick(leafMats);
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

    const hallLabel = makeLabel('hall', 'Counting House · Tithe');
    labelsEl.appendChild(hallLabel);

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
        if (id) router.push(`/agents/${id}`);
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

        const want =
          b.status === 'working'
            ? 0.95 + (reduceMotion ? 0 : Math.sin(t * 3 + b.phase) * 0.15)
            : b.status === 'review'
              ? 0.6
              : 0.05;
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
        highlightLabel(b.label, hovered);
      });

      const hb = hoverId ? buildings.get(hoverId) : undefined;
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
      distLabels.forEach((l) => {
        project(l.pos, l.el);
        l.el.style.opacity = String(grow(l.delay, 0.4, easeOut));
      });
      labelPos.set(0, 6.4, 0);
      project(labelPos, hallLabel);
      hallLabel.style.opacity = String(grow(0.6, 0.4, easeOut));

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
      renderer.dispose();
      cv.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agentsRef dipakai untuk data live, scene dibangun sekali per mount
  }, [router]);

  return (
    <div
      ref={stageRef}
      className="relative h-full min-h-[420px] w-full overflow-hidden"
      style={{
        background:
          'radial-gradient(120% 90% at 50% 40%, #fff3d6 0%, #a9d8fb 78%)',
      }}
    >
      <div ref={labelsRef} className="pointer-events-none absolute inset-0" />

      <div className="pointer-events-none absolute left-3 top-2.5 z-10 flex max-w-[70%] flex-wrap gap-x-2.5 gap-y-1 rounded-xl bg-white/80 px-2.5 py-1.5 text-[11px] font-medium text-[#4a516d] shadow-sm">
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
        {([-1, 1] as const).map((dir) => (
          <button
            key={dir}
            type="button"
            onClick={() => nudgeRef.current?.(dir)}
            aria-label={dir === 1 ? 'Rotate right' : 'Rotate left'}
            className="h-6 w-6 rounded-full bg-white/90 text-[14px] leading-none text-[#4a516d] shadow-sm transition-colors hover:bg-white hover:text-[#2b3257]"
          >
            {dir === 1 ? '›' : '‹'}
          </button>
        ))}
      </div>
    </div>
  );
}
