/* Layout of the forest inside painting № 052 ("Trzy Panie"), measured off the painting itself: seen from
   the spawn point (eye 1.7 m, the gallery's 68° vertical field of view) everything sits where Kosno put it —
   the tree of faces 3.4 m ahead, forking at 3 m around a pale mask; the small blue lady to its left and the
   tall amber lady to its right, both within 3 m; a pollarded willow watching from 6 m; the third (pink)
   lady half hidden in the flowers at the lower right; a dense colonnade of trunks against the light. */
import type { Box } from '../world/layout.ts';

export const FC = [60, 0, 400] as const;          // forest centre, far away from the museum
export const PORTAL: [number, number, number] = [FC[0], 1.55, FC[2] + 5.3];
export const SPAWN: [number, number, number] = [FC[0], 1.7, FC[2] + 3.4];
/* spawn-relative placement: x to the right, d metres ahead */
const at = (x: number, dd: number): [number, number] => [SPAWN[0] + x, SPAWN[2] - dd];
const [HX, HZ] = at(-0.23, 3.4);
export const HERO = { x: HX, z: HZ, h: 3.35, r: 0.4, fork: 2.9, mask: 3.08 };
const [WX, WZ] = at(1.9, 6.4);
export const WILLOW = { x: WX, z: WZ, h: 5.0, r: 0.38 };
export const LADIES: [number, number, number][] = [
  [...at(-0.88, 2.85), 0.88],   // the blue one, left of the tree (1.67 m)
  [...at(0.6, 3.15), 1.23],     // the amber one, right of it (2.34 m)
  [...at(1.18, 2.3), 0.78],     // the pink one, half hidden in the flowers at the lower right
];
export const BOUNDS = 26;

/* trunk kinds */
export const TK = { Bark: 0, Knots: 1, Hero: 2, Pollard: 3, Twig: 4, PollardFace: 5 } as const;

/* trunk instance: base, height, radius, lean axis, tint, taper, bend, kind, palette family
   (0 olive/moss, 1 rose/mauve, 2 ochre/umber, 3 lavender, 4 sunlit cream, 5 twigs & willow whips) */
export interface TrunkRec {
  base: [number, number, number]; h: number; r: number; axis: [number, number, number];
  tint: [number, number, number]; taper: number; bend: number; seed: number; kind: number; fam: number;
}

function mulberry32(a: number) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* base (mid-tone) colour of each palette family, linear-ish 0..1 */
const FAM_BASE: [number, number, number][] = [
  [0.62, 0.62, 0.36], [0.74, 0.56, 0.56], [0.62, 0.44, 0.26], [0.64, 0.6, 0.72], [0.84, 0.8, 0.6], [0.6, 0.4, 0.3],
];

export function forestLayout(count: number) {
  const rnd = mulberry32(52);
  const R = (a: number, b: number) => a + rnd() * (b - a);
  const trunks: TrunkRec[] = [];
  const twigs: TrunkRec[] = [];
  const walls: Box[] = [];
  const B = BOUNDS;
  walls.push({ x0: FC[0] - B - 1, x1: FC[0] + B + 1, z0: FC[2] + B, z1: FC[2] + B + 1 });
  walls.push({ x0: FC[0] - B - 1, x1: FC[0] + B + 1, z0: FC[2] - B - 1, z1: FC[2] - B });
  walls.push({ x0: FC[0] - B - 1, x1: FC[0] - B, z0: FC[2] - B, z1: FC[2] + B });
  walls.push({ x0: FC[0] + B, x1: FC[0] + B + 1, z0: FC[2] - B, z1: FC[2] + B });

  const up: [number, number, number] = [0, 1, 0];
  const lean = (amt: number): [number, number, number] => {
    const a = R(0, Math.PI * 2), t = R(0, amt);
    return [Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a)];
  };
  const dirUp = (tilt: number, az: number): [number, number, number] => [Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)];
  const tintOf = (fam: number) => FAM_BASE[fam].map(c => c * R(0.88, 1.1)) as [number, number, number];
  const pickFam = () => { const x = rnd(); return x < 0.34 ? 0 : x < 0.56 ? 1 : x < 0.74 ? 3 : x < 0.9 ? 4 : 2; };

  /* bare crowns: limbs off the upper trunk, twigs off every limb (all drawn with the cheap twig mesh) */
  const crown = (x: number, z: number, h: number, r: number, fam: number, nLimbs: number) => {
    for (let b = 0; b < nLimbs; b++) {
      const az = R(0, Math.PI * 2), y = h * R(0.6, 0.92), tilt = R(0.45, 0.85);
      const ax = dirUp(tilt, az), lh = R(1.8, 3.6), lr = r * R(0.22, 0.34);
      twigs.push({ base: [x, y, z], h: lh, r: lr, axis: ax, tint: tintOf(5), taper: 0.35, bend: 0.45, seed: rnd(), kind: TK.Twig, fam });
      const nt = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < nt; k++) {
        const f = R(0.45, 0.95);
        const p: [number, number, number] = [x + ax[0] * lh * f, y + ax[1] * lh * f, z + ax[2] * lh * f];
        twigs.push({ base: p, h: R(0.8, 1.8), r: lr * R(0.3, 0.45), axis: dirUp(R(0.25, 0.9), az + R(-1.2, 1.2)), tint: tintOf(5), taper: 0.3, bend: 0.5, seed: rnd(), kind: TK.Twig, fam: 5 });
      }
    }
  };

  /* the tree of faces: a trunk crowded with faces up to the fork, where the pale mask grins between
     two tall limbs that carry on above the painting's top edge */
  trunks.push({ base: [HERO.x, -0.15, HERO.z], h: HERO.h, r: HERO.r, axis: up, tint: [0.66, 0.46, 0.28], taper: 0.85, bend: 0.06, seed: 0.37, kind: TK.Hero, fam: 2 });
  walls.push({ x0: HERO.x - 0.5, x1: HERO.x + 0.5, z0: HERO.z - 0.5, z1: HERO.z + 0.5 });
  const limbs: [number, number, number, number, number, number][] = [   // dx, dz (lean), radius, length, family, kind
    [-0.36, 0.03, 0.27, 12, 2, TK.Knots], [0.24, -0.06, 0.26, 12.5, 2, TK.Knots], [0.05, -0.5, 0.16, 6, 0, TK.Bark],
  ];
  for (const [lx, lz, lr, lh, fam, kind] of limbs) {
    const l = Math.hypot(lx, 1, lz);
    const ax: [number, number, number] = [lx / l, 1 / l, lz / l];
    trunks.push({ base: [HERO.x + lx * 0.5, HERO.fork, HERO.z + lz * 0.5 - 0.06], h: lh, r: lr, axis: ax, tint: tintOf(fam), taper: 0.5, bend: 0.2, seed: rnd(), kind, fam });
    crown(HERO.x + ax[0] * lh * 0.5, HERO.z + ax[2] * lh * 0.5, HERO.fork + lh * 0.55, lr * 1.4, fam, 4);
  }

  /* pollarded willows (wierzba głowiasta): a short thick trunk, a knobbly head, a crown of straight whips */
  const willow = (x: number, z: number, h: number, r: number, kind: number) => {
    trunks.push({ base: [x, -0.15, z], h, r, axis: lean(0.05), tint: tintOf(1), taper: 0.86, bend: 0.22, seed: rnd(), kind, fam: 1 });
    walls.push({ x0: x - r, x1: x + r, z0: z - r, z1: z + r });
    const n = 26 + Math.floor(rnd() * 14);
    for (let k = 0; k < n; k++) {
      const az = R(0, Math.PI * 2), rr = r * R(0.5, 1.2);
      twigs.push({
        base: [x + Math.cos(az) * rr * 0.6, h * R(0.94, 1.02), z + Math.sin(az) * rr * 0.6],
        h: R(2.2, 4.4), r: R(0.028, 0.06), axis: dirUp(R(0.08, 0.6), az), tint: tintOf(5), taper: 0.25, bend: 0.25, seed: rnd(), kind: TK.Twig, fam: 5,
      });
    }
  };
  willow(WILLOW.x, WILLOW.z, WILLOW.h, WILLOW.r, TK.PollardFace);
  willow(FC[0] - 8.6, FC[2] - 10.5, 5.4, 0.42, TK.Pollard);
  willow(FC[0] + 10.5, FC[2] - 14, 5.8, 0.44, TK.Pollard);
  willow(FC[0] - 12, FC[2] - 3.5, 5.0, 0.4, TK.Pollard);

  /* trunks framing the view at the painting's edges */
  const tree = (x: number, z: number, h: number, r: number, kind: number, fam: number) => {
    trunks.push({ base: [x, -0.15, z], h, r, axis: lean(0.06), tint: tintOf(fam), taper: R(0.5, 0.7), bend: R(0.15, 0.45), seed: rnd(), kind, fam });
    walls.push({ x0: x - r, x1: x + r, z0: z - r, z1: z + r });
    if (rnd() < 0.35) {
      const fa = R(0, Math.PI * 2);
      trunks.push({ base: [x, h * R(0.5, 0.65), z], h: h * R(0.45, 0.6), r: r * 0.62, axis: [Math.cos(fa) * 0.42, 0.9, Math.sin(fa) * 0.42], tint: tintOf(fam), taper: 0.42, bend: 0.3, seed: rnd(), kind: TK.Bark, fam });
    }
    crown(x, z, h, r, fam, 3 + Math.floor(rnd() * 3));
  };
  /* the painting's colonnade, trunk by trunk (x, distance, radius, kind, family) */
  const painted: [number, number, number, number, number][] = [
    [-2.7, 5.2, 0.26, TK.Knots, 0], [-1.9, 6.6, 0.32, TK.Knots, 4], [-3.6, 8.5, 0.24, TK.Bark, 1], [-1.1, 8.8, 0.2, TK.Bark, 3],
    [0.45, 5.6, 0.27, TK.Knots, 4], [1.0, 8.0, 0.2, TK.Bark, 3], [3.2, 8.6, 0.22, TK.Bark, 1], [2.9, 6.2, 0.27, TK.Knots, 1],
    [4.3, 5.0, 0.3, TK.Bark, 0], [-4.1, 4.0, 0.32, TK.Knots, 0], [-0.4, 11, 0.28, TK.Bark, 0], [2.0, 11.5, 0.3, TK.Knots, 3],
  ];
  for (const [x, dd, r, kind, fam] of painted) {
    const [px, pz] = at(x, dd);
    tree(px, pz, R(11, 16), r, kind, fam);
  }

  /* the grove: a dense colonnade behind the ladies, thinner everywhere else; the meadow in front of
     the great tree stays open so the first view is the painting's */
  const clear = (x: number, z: number) =>
    (z > FC[2] - 7 && z < FC[2] + 7.5 && Math.abs(x - FC[0]) < 5.5) ||
    Math.hypot(x - PORTAL[0], z - PORTAL[2]) < 3 ||
    Math.hypot(x - HERO.x, z - HERO.z) < 3 ||
    Math.hypot(x - WILLOW.x, z - WILLOW.z) < 2 ||
    trunks.some(t => t.base[1] < 1 && Math.hypot(t.base[0] - x, t.base[2] - z) < 1.3);
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 60) {
    const behind = rnd() < 0.6;
    const x = FC[0] + (behind ? R(-15, 15) : R(-24, 24));
    const z = FC[2] + (behind ? R(-24, -7) : R(-24, 24));
    if (clear(x, z)) continue;
    const h = R(9, 15), r = R(0.18, 0.46);
    tree(x, z, h, r, rnd() < 0.16 ? TK.Knots : TK.Bark, pickFam());
    placed++;
  }
  for (const [lx, lz, s] of LADIES) walls.push({ x0: lx - 0.55 * s, x1: lx + 0.55 * s, z0: lz - 0.55 * s, z1: lz + 0.55 * s });

  /* flowering mounds [x, z, size, palette]: 0 pink heather, 1 amber, 2 olive, 3 lavender-blue, 4 dry grass */
  const [L3x, L3z] = LADIES[2];
  const B2 = (x: number, dd: number, size: number, pal: number): [number, number, number, number] => [...at(x, dd), size, pal];
  const bushes: [number, number, number, number][] = [
    [L3x + 0.05, L3z + 0.1, 1.2, 0],                        // the third lady's flowers
    B2(0.75, 2.6, 0.8, 1),                                   // the amber mound at the amber lady's hem
    B2(-0.05, 2.55, 0.55, 0),                                // pink heather at the foot of the tree (bottom of the painting)
    B2(1.9, 4.2, 1.0, 0), B2(2.6, 3.4, 0.7, 0),              // pink heather, right
    B2(3.0, 6.6, 1.0, 3), B2(2.3, 7.4, 0.8, 3),              // the lavender patch, right
    B2(-2.6, 4.8, 0.6, 4), B2(-3.2, 6.4, 0.55, 4), B2(-2.0, 3.0, 0.42, 4),   // dry grass, left
    B2(-1.4, 4.4, 0.6, 1),
  ];
  for (let i = 0; i < 36; i++) {
    const a = R(0, Math.PI * 2), rr = R(6, 22);
    const k = rnd();
    bushes.push([FC[0] + Math.cos(a) * rr, FC[2] + Math.sin(a) * rr, R(0.7, 1.6), k < 0.34 ? 0 : k < 0.56 ? 1 : k < 0.72 ? 2 : k < 0.86 ? 3 : 4]);
  }
  return { trunks, twigs, walls, bushes };
}
