/* One template mesh for every painting: a recessed canvas + a profiled moulding with a gilt liner.
   Vertices carry (corner sign, side direction, profile offset/depth, profile normal, part) and the
   vertex shader expands them to each instance's real size — so all frames are one instanced draw. */
import { CANVAS_Z } from './build.ts';

export const Part = { Canvas: 0, Wood: 1, Gold: 2 } as const;

/* profile: [outward offset from the canvas edge, depth off the wall] */
const PROFILE: [number, number][] = [
  [0.000, CANVAS_Z], [0.010, 0.037], [0.014, 0.037],   // gilt liner
  [0.016, 0.050], [0.030, 0.062], [0.052, 0.058], [0.060, 0.046], [0.060, 0.0],   // moulding
];
const SEG_PART = [Part.Gold, Part.Gold, Part.Wood, Part.Wood, Part.Wood, Part.Wood, Part.Wood];

export const FRAME_STRIDE = 36;

export function buildFrameMesh(): { bytes: ArrayBuffer; count: number } {
  const verts: number[][] = [];
  const push = (cx: number, cy: number, sx: number, sy: number, d: number, z: number, nd: number, nz: number, part: number) =>
    verts.push([cx, cy, sx, sy, d, z, nd, nz, part]);

  // canvas (front-facing, CCW)
  const cv = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  for (const [x, y] of cv) push(x, y, 0, 0, 0, CANVAS_Z, 0, 1, Part.Canvas);

  // four sides, corners traversed clockwise when seen from the front
  const sides: [[number, number], [number, number], [number, number]][] = [
    [[-1, 1], [1, 1], [0, 1]],     // top
    [[1, 1], [1, -1], [1, 0]],     // right
    [[1, -1], [-1, -1], [0, -1]],  // bottom
    [[-1, -1], [-1, 1], [-1, 0]],  // left
  ];
  for (const [c0, c1, o] of sides) {
    for (let j = 0; j < PROFILE.length - 1; j++) {
      const [d0, z0] = PROFILE[j], [d1, z1] = PROFILE[j + 1];
      const dd = d1 - d0, dz = z1 - z0, l = Math.hypot(dd, dz) || 1;
      const nd = -dz / l, nz = dd / l;
      const part = SEG_PART[j];
      const A = [c0[0], c0[1], d0, z0], B = [c1[0], c1[1], d0, z0], C = [c1[0], c1[1], d1, z1], D = [c0[0], c0[1], d1, z1];
      for (const q of [A, B, C, A, C, D]) push(q[0], q[1], o[0], o[1], q[2], q[3], nd, nz, part);
    }
  }

  const buf = new ArrayBuffer(verts.length * FRAME_STRIDE);
  const f = new Float32Array(buf), u = new Uint32Array(buf);
  verts.forEach((v, i) => {
    const o = i * 9;
    for (let k = 0; k < 8; k++) f[o + k] = v[k];
    u[o + 8] = v[8];
  });
  return { bytes: buf, count: verts.length };
}
