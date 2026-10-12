/* One template mesh for every painting and every frame style: a canvas quad plus, on each of the four
   sides, FRAME_MAXP−1 profile segments. A vertex only names its corner, its side and which profile point
   it is (segment j, end k); the vertex shader looks that point up in the painting's frame style
   (themes.ts → a uniform table) and expands it to the instance's size — so all frames, whatever their
   style, stay one instanced draw. Shorter profiles repeat their last point (degenerate segments). */
import { FRAME_MAXP } from './themes.ts';

export const Part = { Canvas: 0, Frame: 1 } as const;
export const CANVAS_Z = 0.03;    // the canvas stands 3 cm off the wall, inside the frame
export const FRAME_STRIDE = 28;  // corner f32x2 · side f32x2 · seg u32x2 · part u32

export function buildFrameMesh(): { bytes: ArrayBuffer; count: number } {
  const verts: number[][] = [];
  const push = (cx: number, cy: number, sx: number, sy: number, j: number, k: number, part: number) =>
    verts.push([cx, cy, sx, sy, j, k, part]);

  // canvas (front-facing, CCW)
  const cv = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  for (const [x, y] of cv) push(x, y, 0, 0, 0, 0, Part.Canvas);

  // four sides, corners traversed clockwise when seen from the front
  const sides: [[number, number], [number, number], [number, number]][] = [
    [[-1, 1], [1, 1], [0, 1]],     // top
    [[1, 1], [1, -1], [1, 0]],     // right
    [[1, -1], [-1, -1], [0, -1]],  // bottom
    [[-1, -1], [-1, 1], [-1, 0]],  // left
  ];
  for (const [c0, c1, o] of sides) {
    for (let j = 0; j < FRAME_MAXP - 1; j++) {
      const A = [c0[0], c0[1], 0], B = [c1[0], c1[1], 0], C = [c1[0], c1[1], 1], D = [c0[0], c0[1], 1];
      for (const q of [A, B, C, A, C, D]) push(q[0], q[1], o[0], o[1], j, q[2], Part.Frame);
    }
  }

  const buf = new ArrayBuffer(verts.length * FRAME_STRIDE);
  const f = new Float32Array(buf), u = new Uint32Array(buf);
  verts.forEach((v, i) => {
    const o = i * 7;
    for (let k = 0; k < 4; k++) f[o + k] = v[k];
    u[o + 4] = v[4]; u[o + 5] = v[5]; u[o + 6] = v[6];
  });
  return { bytes: buf, count: verts.length };
}
