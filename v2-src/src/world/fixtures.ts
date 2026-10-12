/* The light fittings themselves — what makes the light on the walls and paintings believable:
   - ceiling track spots: a rail parallel to the wall, a stem, a can aimed at its painting, a glowing lens
   - picture lamps: a brass arm off the wall above the frame and a hood with a glowing bulb inside
   - ceiling lamps, one design per room (chandeliers, pendants, lanterns, laylights …)
   Everything goes into the merged static mesh. */
import { MeshBuilder, Mat, hexCol, type V3, type VertexAttrs, add, sub, scale } from './mesh.ts';
import { lathe, cyl, tube, sphere, disc, box, frameAt, toWorld, tri, dot } from './shapes.ts';
import { WALL_H } from './layout.ts';
import { CeilLamp } from './themes.ts';

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


/* ---------------- ceiling lamps ---------------- */

/* how each ceiling lamp lights the room: centre height, half-size of the glowing volume, whether it is
   a flat downward area light (laylights), the share of light going down / up, its power and colour */
export interface LampSpec { y: number; h: V3; lambert: number; down: number; up: number; power: number; color: string }
export const LAMPS: Record<number, LampSpec> = {
  [CeilLamp.Halo]:      { y: 3.25, h: [0.75, 0.04, 0.75], lambert: 0, down: 1, up: 0.5, power: 4.2, color: '#fff0d6' },
  [CeilLamp.Murano]:    { y: 3.05, h: [0.45, 0.3, 0.45], lambert: 0, down: 1, up: 0.7, power: 2.4, color: '#ffe0b0' },
  [CeilLamp.Drum]:      { y: 3.15, h: [0.32, 0.14, 0.32], lambert: 0, down: 1, up: 0.3, power: 2.1, color: '#fff0d8' },
  [CeilLamp.Cartwheel]: { y: 3.3, h: [0.72, 0.08, 0.72], lambert: 0, down: 1, up: 0.55, power: 2.8, color: '#ffd8a0' },
  [CeilLamp.Lantern]:   { y: 3.0, h: [0.13, 0.2, 0.13], lambert: 0, down: 1, up: 0.45, power: 2.4, color: '#ffe6bc' },
  [CeilLamp.Ship]:      { y: 3.3, h: [0.11, 0.11, 0.11], lambert: 0, down: 1, up: 0.35, power: 2.5, color: '#fff0d8' },
  [CeilLamp.Laylight]:  { y: WALL_H - 0.01, h: [1.5, 0, 0.8], lambert: 1, down: 1, up: 0, power: 5.2, color: '#f8f6f0' },
  [CeilLamp.Tulip]:     { y: 3.1, h: [0.42, 0.2, 0.42], lambert: 0, down: 1, up: 0.35, power: 2.6, color: '#ffdcaa' },
  [CeilLamp.Alabaster]: { y: 3.3, h: [0.38, 0.1, 0.38], lambert: 0, down: 0.45, up: 1.3, power: 2.6, color: '#ffeacc' },
  [CeilLamp.Enamel]:    { y: 3.0, h: [0.22, 0.08, 0.22], lambert: 0, down: 1, up: 0.14, power: 3.0, color: '#f6f6f2' },
  [CeilLamp.Paper]:     { y: 2.95, h: [0.28, 0.34, 0.28], lambert: 0, down: 1, up: 0.8, power: 2.8, color: '#ffc890' },
};

const matte = (hex: string, room: number, rough = 0.85): VertexAttrs => ({ col: hexCol(hex, rough), mat: Mat.Matte, room });
const woodA = (hex: string, room: number): VertexAttrs => ({ col: hexCol(hex, 0.6), mat: Mat.Wood, room });
const glassA = (hex: string, room: number, glow: number): VertexAttrs => ({ col: hexCol(hex, glow), mat: Mat.Glass, room });
const paperA = (hex: string, room: number, glow: number): VertexAttrs => ({ col: hexCol(hex, glow), mat: Mat.Paper, room });
const enamelA = (hex: string, room: number): VertexAttrs => ({ col: hexCol(hex, 0.25), mat: Mat.Enamel, room });

function torus(mb: MeshBuilder, c: V3, R: number, r: number, seg: number, a: VertexAttrs) {
  const prof: [number, number][] = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8 * Math.PI * 2; prof.push([R + r * Math.cos(t), r * Math.sin(t)]); }
  lathe(mb, frameAt(c), prof, seg, a);
}
/* the ceiling rose and the cable / rod down to the lamp */
function hang(mb: MeshBuilder, x: number, z: number, bottom: number, m: VertexAttrs, r = 0.005) {
  lathe(mb, frameAt([x, WALL_H, z]), [[0.001, -0.04], [0.07, -0.032], [0.085, -0.012], [0.09, 0]], 18, m);
  cyl(mb, [x, bottom, z], [x, WALL_H - 0.035, z], r, 8, m, false);
}
const at = (c: V3, r: number, ang: number, y: number): V3 => [c[0] + Math.cos(ang) * r, c[1] + y, c[2] + Math.sin(ang) * r];
function candle(mb: MeshBuilder, base: V3, room: number, cup: VertexAttrs) {
  cyl(mb, add(base, [0, -0.012, 0]), add(base, [0, 0.008, 0]), 0.026, 10, cup, true, 0.03);
  cyl(mb, add(base, [0, 0.008, 0]), add(base, [0, 0.085, 0]), 0.012, 8, matte('#f2ead8', room, 0.7), true);
  sphere(mb, add(base, [0, 0.105, 0]), 0.013, 8, glowA('#ffcf80', room, 2.4), 1.7);
}

export function ceilingLamp(mb: MeshBuilder, kind: number, x: number, z: number, room: number, metal: string) {
  const s = LAMPS[kind];
  const c: V3 = [x, s.y, z];
  const m = metalA(metal, room, 0.3);
  switch (kind) {
    case CeilLamp.Halo: {          // the lobby: a wide brass ring glowing underneath
      torus(mb, c, 0.75, 0.03, 56, m);
      disc(mb, frameAt(c), 0.775, -0.026, 56, glowA('#fff2dc', room, 1.6), false, 0.725);
      lathe(mb, frameAt([x, WALL_H, z]), [[0.001, -0.04], [0.07, -0.032], [0.085, -0.012], [0.09, 0]], 18, m);
      for (let k = 0; k < 3; k++) cyl(mb, at(c, 0.75, k * 2.094, 0.02), [x, WALL_H - 0.035, z], 0.0025, 6, m, false);
      break;
    }
    case CeilLamp.Murano: {        // Venice: an amber glass chandelier with candle arms and glass flowers
      const g = glassA('#e8b468', room, 0.32);
      lathe(mb, frameAt(c), [[0.03, -0.34], [0.07, -0.28], [0.09, -0.2], [0.05, -0.1], [0.075, 0.04], [0.045, 0.2], [0.03, 0.34]], 20, g);
      cyl(mb, add(c, [0, 0.34, 0]), [x, WALL_H - 0.035, z], 0.016, 10, g, false);
      lathe(mb, frameAt([x, WALL_H, z]), [[0.001, -0.04], [0.07, -0.032], [0.085, -0.012], [0.09, 0]], 18, m);
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        tube(mb, [at(c, 0.06, a, -0.16), at(c, 0.2, a, -0.27), at(c, 0.34, a, -0.16), at(c, 0.42, a, -0.02)], 0.012, 8, g);
        candle(mb, at(c, 0.42, a, 0.0), room, g);
        sphere(mb, at(c, 0.27, a + 0.2, -0.24), 0.028, 10, glassA(k % 2 ? '#e898b0' : '#78c0b8', room, 0.35));
      }
      break;
    }
    case CeilLamp.Drum: {          // landscapes: linen drum shades on a cable
      hang(mb, x, z, s.y + 0.14, m, 0.004);
      const f = frameAt(c);
      lathe(mb, f, [[0.32, -0.14], [0.32, 0.14]], 32, paperA('#efe2c8', room, 0.5));
      lathe(mb, f, [[0.315, -0.14], [0.315, 0.14]], 32, paperA('#fff0d8', room, 0.95), { inside: true });
      disc(mb, f, 0.315, -0.125, 32, paperA('#fff4e0', room, 1.15), false);
      torus(mb, add(c, [0, 0.14, 0]), 0.32, 0.006, 32, m);
      torus(mb, add(c, [0, -0.14, 0]), 0.32, 0.006, 32, m);
      for (let k = 0; k < 3; k++) cyl(mb, add(c, [0, 0.14, 0]), at(c, 0.32, k * 2.094, 0.14), 0.004, 6, m, false);
      break;
    }
    case CeilLamp.Cartwheel: {     // the Tatra: a carved wooden cartwheel with candles, hung on iron rods
      const w = woodA('#7a4e2a', room);
      torus(mb, c, 0.72, 0.04, 48, w);
      cyl(mb, add(c, [0, -0.07, 0]), add(c, [0, 0.07, 0]), 0.08, 12, w);
      for (let k = 0; k < 8; k++) cyl(mb, c, at(c, 0.7, k * Math.PI / 4, 0), 0.02, 8, w, false);
      for (let k = 0; k < 4; k++) cyl(mb, at(c, 0.72, k * Math.PI / 2 + 0.39, 0.03), add(c, [0, 0.7, 0]), 0.006, 6, m, false);
      hang(mb, x, z, s.y + 0.7, m, 0.008);
      for (let k = 0; k < 8; k++) candle(mb, at(c, 0.72, k * Math.PI / 4 + 0.39, 0.05), room, m);
      break;
    }
    case CeilLamp.Lantern: {       // Polish cities: a hexagonal old-town street lantern
      hang(mb, x, z, s.y + 0.3, m, 0.012);
      const f = frameAt(c);
      lathe(mb, f, [[0.15, 0.17], [0.17, 0.2], [0.03, 0.31]], 6, m);
      sphere(mb, add(c, [0, 0.33, 0]), 0.025, 8, m);
      lathe(mb, f, [[0.115, -0.17], [0.15, 0.17]], 6, glassA('#ffe0a8', room, 0.62));
      lathe(mb, f, [[0.02, -0.27], [0.1, -0.21], [0.12, -0.17]], 6, m);
      for (let k = 0; k < 6; k++) cyl(mb, at(c, 0.118, k * Math.PI / 3, -0.17), at(c, 0.153, k * Math.PI / 3, 0.17), 0.006, 6, m, false);
      sphere(mb, c, 0.04, 10, glowA('#ffd9a0', room, 2.2), 1.4);
      break;
    }
    case CeilLamp.Ship: {          // marines: a caged brass ship's lamp with a glass globe
      hang(mb, x, z, s.y + 0.14, m, 0.008);
      const f = frameAt(c);
      lathe(mb, f, [[0.1, 0.09], [0.105, 0.11], [0.05, 0.14]], 20, m);
      sphere(mb, c, 0.1, 20, glassA('#fff0d8', room, 0.6));
      lathe(mb, f, [[0.03, -0.13], [0.07, -0.1], [0.075, -0.09]], 20, m);
      torus(mb, c, 0.106, 0.006, 24, m);
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2;
        const pts: V3[] = [];
        for (let j = 0; j <= 6; j++) { const t = -1.1 + 2.2 * j / 6; pts.push(at(c, 0.107 * Math.cos(t), a, 0.107 * Math.sin(t))); }
        tube(mb, pts, 0.005, 6, m);
      }
      break;
    }
    case CeilLamp.Laylight: {      // impressions: frosted laylights set into the ceiling
      const y = WALL_H;
      box(mb, [x, y - 0.004, z], [1.6, 0.004, 0.9], matte('#e8e4dc', room, 0.9), 0, 'ny');
      box(mb, [x, y - 0.012, z], [1.5, 0.004, 0.8], glowA('#f8f6f0', room, 0.95), 0, 'ny');
      for (const bx of [-0.5, 0.5]) box(mb, [x + bx, y - 0.03, z], [0.02, 0.02, 0.8], matte('#e8e4dc', room, 0.8));
      box(mb, [x, y - 0.03, z], [1.5, 0.02, 0.02], matte('#e8e4dc', room, 0.8));
      break;
    }
    case CeilLamp.Tulip: {         // scenes & symbolism: an Art Nouveau chandelier with amber tulip shades
      hang(mb, x, z, s.y + 0.06, m, 0.01);
      torus(mb, add(c, [0, 0.06, 0]), 0.28, 0.01, 32, m);
      sphere(mb, add(c, [0, 0.03, 0]), 0.05, 12, m, 1.4);
      for (let k = 0; k < 5; k++) {
        const a = k * Math.PI * 2 / 5;
        tube(mb, [add(c, [0, 0.06, 0]), at(c, 0.22, a, 0.16), at(c, 0.38, a, 0.1), at(c, 0.42, a, 0.0)], 0.009, 8, m);
        const tc = at(c, 0.42, a, -0.01);
        const f = frameAt(tc);
        lathe(mb, f, [[0.08, -0.17], [0.09, -0.12], [0.07, -0.05], [0.025, 0]], 16, glassA('#eaa860', room, 0.55));
        lathe(mb, f, [[0.077, -0.17], [0.087, -0.12], [0.067, -0.05], [0.022, 0]], 16, glassA('#ffd090', room, 1.0), { inside: true });
        sphere(mb, add(tc, [0, -0.07, 0]), 0.028, 8, glowA('#ffe0a8', room, 2.0));
      }
      break;
    }
    case CeilLamp.Alabaster: {     // portraits: alabaster bowls on three chains, washing the ceiling with light
      lathe(mb, frameAt([x, WALL_H, z]), [[0.001, -0.04], [0.07, -0.032], [0.085, -0.012], [0.09, 0]], 18, m);
      for (let k = 0; k < 3; k++) cyl(mb, at(c, 0.37, k * 2.094, 0.08), [x, WALL_H - 0.035, z], 0.004, 6, m, false);
      const f = frameAt(c);
      const prof: [number, number][] = [[0.02, -0.1], [0.2, -0.08], [0.33, -0.02], [0.38, 0.08]];
      lathe(mb, f, prof, 32, paperA('#efe0c4', room, 0.5));
      lathe(mb, f, prof.map(([r, y]) => [r * 0.97, y + 0.004] as [number, number]), 32, paperA('#fff2dc', room, 1.2), { inside: true });
      torus(mb, add(c, [0, 0.08, 0]), 0.38, 0.01, 32, m);
      sphere(mb, add(c, [0, -0.11, 0]), 0.025, 8, m);
      break;
    }
    case CeilLamp.Enamel: {        // drawings: green enamel studio pendants
      hang(mb, x, z, s.y + 0.09, m, 0.004);
      const f = frameAt(c);
      const prof: [number, number][] = [[0.22, -0.08], [0.2, -0.05], [0.07, 0.05], [0.045, 0.09]];
      lathe(mb, f, prof, 28, enamelA('#2f5a3e', room));
      lathe(mb, f, prof.map(([r, y]) => [r * 0.97, y] as [number, number]), 28, glowA('#fff6e6', room, 0.32), { inside: true });
      sphere(mb, add(c, [0, -0.035, 0]), 0.045, 12, glowA('#fff6e6', room, 1.8));
      break;
    }
    case CeilLamp.Paper: {         // the secret room: paper lanterns, warm against the blue
      hang(mb, x, z, s.y + 0.36, metalA('#1a1410', room, 0.4), 0.004);
      const lac = enamelA('#1a1410', room);
      const f = frameAt(c);
      const prof: [number, number][] = [];
      for (let k = 0; k <= 12; k++) { const t = -1.25 + 2.5 * k / 12; prof.push([0.28 * Math.cos(t), 0.34 * Math.sin(t)]); }
      lathe(mb, f, prof, 28, paperA('#f6d4a0', room, 0.9));
      for (let k = 1; k < 12; k += 2) { const t = -1.25 + 2.5 * k / 12; torus(mb, add(c, [0, 0.34 * Math.sin(t), 0]), 0.28 * Math.cos(t) + 0.002, 0.003, 28, matte('#6a4426', room, 0.7)); }
      cyl(mb, add(c, [0, 0.31, 0]), add(c, [0, 0.36, 0]), 0.1, 16, lac);
      cyl(mb, add(c, [0, -0.36, 0]), add(c, [0, -0.31, 0]), 0.1, 16, lac);
      break;
    }
  }
}
