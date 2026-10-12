/* The light fittings themselves — what makes the light on the walls and paintings believable:
   - ceiling track spots: a rail parallel to the wall, a stem, a can aimed at its painting, a glowing lens
   - picture lamps: a brass arm off the wall above the frame and a hood with a glowing bulb inside
   - ceiling lamps, one design per room (chandeliers, pendants, lanterns, laylights …)
   Everything goes into the merged static mesh. */
import { MeshBuilder, Mat, hexCol, type V3, type VertexAttrs, add, sub, scale } from './mesh.ts';
import { lathe, cyl, tube, sphere, disc, box, frameAt, toWorld, tri, dot } from './shapes.ts';
import { WALL_H } from './layout.ts';

export interface LampLight {
  pos: V3; dir: V3; right: V3; normal: V3; center: V3; half: [number, number]; seg: number; room: number;
}

const metalA = (hex: string, room: number, rough = 0.32): VertexAttrs => ({ col: hexCol(hex, rough), mat: Mat.Metal, room });
const glowA = (hex: string, room: number, k = 1): VertexAttrs => ({ col: hexCol(hex, k), mat: Mat.Emissive, room });

/* a ceiling track spot at the light's position, aimed along its direction */
export function trackSpot(mb: MeshBuilder, l: LampLight, metal: string) {
  const m = metalA(metal, l.room, 0.35);
  const S = l.pos;
  const back = sub(S, scale(l.dir, 0.09)), front = add(S, scale(l.dir, 0.06));
  cyl(mb, back, front, 0.034, 14, m, true, 0.04);
  // glowing lens, slightly recessed behind a rim
  const fl = frameAt(front, l.dir);
  disc(mb, fl, 0.03, -0.004, 14, glowA('#fff1d6', l.room, 1.6), true);
  disc(mb, fl, 0.04, 0, 14, m, true, 0.03);
  // stem up to the rail, with a little knuckle
  const top: V3 = [S[0], WALL_H - 0.03, S[2]];
  const knuckle: V3 = [S[0], S[1] + 0.05, S[2]];
  cyl(mb, knuckle, top, 0.007, 8, m, false);
  sphere(mb, knuckle, 0.014, 8, m);
}

/* the rail a row of spots hangs from: runs along the wall over the extent of its lights */
export function trackRail(mb: MeshBuilder, ls: LampLight[], metal: string) {
  if (!ls.length) return;
  const t = ls[0].right;
  const along = ls.map(l => dot(l.pos, t));
  const a0 = Math.min(...along) - 0.45, a1 = Math.max(...along) + 0.45;
  const p = ls[0].pos;
  const base = sub(p, scale(t, dot(p, t)));       // the rail line through the first light
  const c = add(base, scale(t, (a0 + a1) / 2));
  box(mb, [c[0], WALL_H - 0.016, c[2]], [(a1 - a0) / 2, 0.016, 0.018], metalA(metal, ls[0].room, 0.4), Math.atan2(-t[2], t[0]), 'px nx ny pz nz');
}

/* a brass picture lamp: wall plate and arm above the frame, a hood with a glowing bulb inside */
export function pictureLamp(mb: MeshBuilder, l: LampLight, metal: string) {
  const m = metalA(metal, l.room, 0.25);
  const up: V3 = [0, 1, 0];
  const R = l.right, N = l.normal;
  const half = l.seg + 0.03;
  const o = sub(l.pos, scale(R, half));
  const f = frameAt(o, R, up);                      // y along the hood, x up, z towards the wall
  const L = half * 2, r = 0.042;
  const a0 = -0.85 * Math.PI, a1 = 0.4 * Math.PI;
  lathe(mb, f, [[r, 0], [r, L]], 18, m, { a0, a1 });
  lathe(mb, f, [[r - 0.003, 0], [r - 0.003, L]], 18, glowA('#ffd9a0', l.room, 0.22), { a0, a1, inside: true });
  // end caps (both faces)
  for (const h of [0, L]) {
    for (let i = 0; i < 10; i++) {
      const t0 = a0 + (a1 - a0) * i / 10, t1 = a0 + (a1 - a0) * (i + 1) / 10;
      const P = (t: number) => toWorld(f, [r * Math.cos(t), h, r * Math.sin(t)]);
      const c = toWorld(f, [0, h, 0]);
      for (const s of [1, -1]) { const n = scale(f.y, s); tri(mb, [c, P(t0), P(t1)], [n, n, n], m, n); }
    }
  }
  // the bulb
  cyl(mb, toWorld(f, [-0.005, 0.02, 0.006]), toWorld(f, [-0.005, L - 0.02, 0.006]), 0.009, 8, glowA('#fff0d0', l.room, 2.2), true);
  // the arm off the wall plate
  const top = l.center[1] + l.half[1] + 0.05;
  const W: V3 = [l.center[0], top, l.center[2]];
  box(mb, add(W, scale(N, 0.006)), [0.03, 0.024, 0.006], m, Math.atan2(-R[2], R[0]));
  tube(mb, [add(W, scale(N, 0.01)), add(add(W, scale(N, 0.11)), [0, 0.07, 0]), add(l.pos, scale(up, 0.044))], 0.0065, 8, m);
}

