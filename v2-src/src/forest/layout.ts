/* Layout of the forest inside painting № 052 ("Trzy Panie"): trunk placement, the great tree of faces,
   the three ladies and colliders — v1 positions, denser grove (GPU instancing makes trees cheap). */
import type { Box } from '../world/layout.ts';

export const FC = [60, 0, 400] as const;          // forest centre, far away from the museum
export const PORTAL: [number, number, number] = [FC[0], 1.55, FC[2] + 5.3];
export const SPAWN: [number, number, number] = [FC[0], 1.7, FC[2] + 3.4];
export const HERO = { x: FC[0] + 0.6, z: FC[2] - 8.8, h: 15, r: 1.3 };
export const LADIES: [number, number, number][] = [
  [FC[0] - 4.8, FC[2] - 11.2, 1.35],   // the blue one
  [FC[0] + 4.0, FC[2] - 10.4, 1.55],   // the amber one
  [FC[0] + 0.9, FC[2] - 13.8, 1.2],    // the violet one
];
export const BOUNDS = 26;

/* trunk instance: base, height, radius, lean axis, tint, taper, bend, kind (0 bark, 1 owl eyes, 2 hero) */
export interface TrunkRec {
  base: [number, number, number]; h: number; r: number; axis: [number, number, number];
  tint: [number, number, number]; taper: number; bend: number; seed: number; kind: number;
}

function mulberry32(a: number) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* tints from the painting: olive, moss, rose, lavender, ochre, umber */
const TINTS: [number, number, number][] = [
  [0.78, 0.76, 0.5], [0.64, 0.66, 0.42], [0.86, 0.66, 0.66], [0.74, 0.66, 0.8], [0.88, 0.76, 0.48], [0.62, 0.5, 0.38], [0.9, 0.84, 0.7],
];

export function forestLayout(count: number) {
  const rnd = mulberry32(52);
  const R = (a: number, b: number) => a + rnd() * (b - a);
  const trunks: TrunkRec[] = [];
  const walls: Box[] = [];
  const B = BOUNDS;
  walls.push({ x0: FC[0] - B - 1, x1: FC[0] + B + 1, z0: FC[2] + B, z1: FC[2] + B + 1 });
  walls.push({ x0: FC[0] - B - 1, x1: FC[0] + B + 1, z0: FC[2] - B - 1, z1: FC[2] - B });
  walls.push({ x0: FC[0] - B - 1, x1: FC[0] - B, z0: FC[2] - B, z1: FC[2] + B });
  walls.push({ x0: FC[0] + B, x1: FC[0] + B + 1, z0: FC[2] - B, z1: FC[2] + B });

  const up: [number, number, number] = [0, 1, 0];
  const lean = (amt: number): [number, number, number] => {
    const a = R(0, Math.PI * 2), t = R(0, amt);
    const v = [Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a)];
    return v as [number, number, number];
  };
  const tint = () => TINTS[Math.floor(rnd() * TINTS.length)].map(c => c * R(0.88, 1.08)) as [number, number, number];

  // the great tree of faces + its heavy limbs
  trunks.push({ base: [HERO.x, -0.2, HERO.z], h: HERO.h, r: HERO.r, axis: up, tint: [0.92, 0.82, 0.62], taper: 0.5, bend: 0.5, seed: 0.37, kind: 2 });
  walls.push({ x0: HERO.x - 1.2, x1: HERO.x + 1.2, z0: HERO.z - 1.2, z1: HERO.z + 1.2 });
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + R(-0.3, 0.3), y = R(8.5, 12.5);
    const ax: [number, number, number] = [Math.cos(a) * 0.75, 0.66, Math.sin(a) * 0.75];
    trunks.push({ base: [HERO.x + Math.cos(a) * 0.5, y, HERO.z + Math.sin(a) * 0.5], h: R(3.5, 5.5), r: R(0.18, 0.3), axis: ax, tint: [0.88, 0.78, 0.6], taper: 0.3, bend: 0.4, seed: rnd(), kind: 0 });
  }

  // the grove: denser behind the ladies, like the painting's receding colonnade of trunks
  const clear = (x: number, z: number) =>
    Math.hypot(x - FC[0], z - FC[2]) < 4.8 ||
    Math.hypot(x - PORTAL[0], z - PORTAL[2]) < 3 ||
    Math.hypot(x - HERO.x, z - HERO.z) < 3.2 ||
    LADIES.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 2.2);
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 40) {
    const behind = rnd() < 0.55;
    const x = FC[0] + (behind ? R(-16, 16) : R(-24, 24));
    const z = FC[2] + (behind ? R(-24, -6) : R(-24, 24));
    if (clear(x, z)) continue;
    if (trunks.some(t => t.kind !== 2 && t.base[1] < 1 && Math.hypot(t.base[0] - x, t.base[2] - z) < 1.1)) continue;
    const h = R(8, 14), r = R(0.17, 0.46);
    const kind = rnd() < 0.14 ? 1 : 0;
    const tn = tint();
    trunks.push({ base: [x, -0.15, z], h, r, axis: lean(0.08), tint: tn, taper: R(0.45, 0.7), bend: R(0.15, 0.5), seed: rnd(), kind });
    walls.push({ x0: x - r, x1: x + r, z0: z - r, z1: z + r });
    // forked trunks and the bare branching crowns
    if (rnd() < 0.35) {
      const fa = R(0, Math.PI * 2);
      trunks.push({ base: [x, h * R(0.45, 0.6), z], h: h * R(0.45, 0.6), r: r * 0.65, axis: [Math.cos(fa) * 0.45, 0.9, Math.sin(fa) * 0.45], tint: tn, taper: 0.4, bend: 0.3, seed: rnd(), kind: 0 });
    }
    const nb = 2 + Math.floor(rnd() * 3);
    for (let b = 0; b < nb; b++) {
      const ba = R(0, Math.PI * 2);
      trunks.push({ base: [x, h * R(0.62, 0.9), z], h: R(1.6, 3.2), r: r * R(0.22, 0.35), axis: [Math.cos(ba) * 0.7, 0.72, Math.sin(ba) * 0.7], tint: tn, taper: 0.25, bend: 0.5, seed: rnd(), kind: 0 });
    }
    placed++;
  }
  for (const [lx, lz] of LADIES) walls.push({ x0: lx - 0.6, x1: lx + 0.6, z0: lz - 0.6, z1: lz + 0.6 });

  /* flower bushes (v1 spots + a ring of extra ones) */
  const bushes: [number, number, number, number][] = [
    [FC[0] - 4.5, FC[2] - 10.0, 1.5, 0], [FC[0] + 3.7, FC[2] - 9.1, 1.6, 1], [FC[0] + 1.1, FC[2] - 12.5, 1.25, 2],
    [FC[0] - 2.0, FC[2] - 1.6, 1.1, 0], [FC[0] + 2.4, FC[2] - 2.6, 1.05, 1],
  ];
  for (let i = 0; i < 34; i++) {
    const a = R(0, Math.PI * 2), rr = R(5, 22);
    bushes.push([FC[0] + Math.cos(a) * rr, FC[2] + Math.sin(a) * rr, R(0.7, 1.6), Math.floor(rnd() * 3)]);
  }
  return { trunks, walls, bushes };
}
