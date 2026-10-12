/* Small solid-modelling helpers on top of MeshBuilder for the furniture and the lamps:
   surfaces of revolution (lathe), cylinders and tubes between points, spheres, rotated and rounded
   boxes. Triangles are wound from their intended outward normal, so back-face culling just works. */
import { MeshBuilder, type V3, type VertexAttrs, add, sub, scale, cross, normalize } from './mesh.ts';

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/* a local frame: origin + three axes (y = the "up" / revolution axis) */
export interface Frame3 { o: V3; x: V3; y: V3; z: V3 }
export function frameAt(o: V3, yAxis: V3 = [0, 1, 0], xHint: V3 = [1, 0, 0]): Frame3 {
  const y = normalize(yAxis);
  let h = xHint;
  if (Math.abs(dot(normalize(h), y)) > 0.95) h = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const x = normalize(sub(h, scale(y, dot(h, y))));
  const z = cross(x, y);
  return { o, x, y, z };
}
export const toWorld = (f: Frame3, p: V3): V3 => add(f.o, add(add(scale(f.x, p[0]), scale(f.y, p[1])), scale(f.z, p[2])));
const dirWorld = (f: Frame3, n: V3): V3 => normalize(add(add(scale(f.x, n[0]), scale(f.y, n[1])), scale(f.z, n[2])));

/* one triangle, wound so that its front faces `out` */
export function tri(mb: MeshBuilder, p: [V3, V3, V3], n: [V3, V3, V3], a: VertexAttrs, out?: V3) {
  const o = out ?? normalize(add(add(n[0], n[1]), n[2]));
  const g = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  const order = dot(g, o) >= 0 ? [0, 1, 2] : [0, 2, 1];
  for (const k of order) {
    const [u, v] = a.uv ? a.uv(p[k]) : [0, 0];
    mb.vertex(p[k], n[k], u, v, a);
  }
}
function quad4(mb: MeshBuilder, p: [V3, V3, V3, V3], n: [V3, V3, V3, V3], a: VertexAttrs) {
  tri(mb, [p[0], p[1], p[2]], [n[0], n[1], n[2]], a);
  tri(mb, [p[0], p[2], p[3]], [n[0], n[2], n[3]], a);
}

/* surface of revolution about the frame's y axis; prof = [radius, height] from bottom to top.
   inside = true flips it (the inner side of a shade); a0..a1 limits the sweep (open hoods). */
export function lathe(mb: MeshBuilder, f: Frame3, prof: [number, number][], seg: number, a: VertexAttrs,
  opts: { inside?: boolean; a0?: number; a1?: number } = {}) {
  const a0 = opts.a0 ?? 0, a1 = opts.a1 ?? Math.PI * 2, sgn = opts.inside ? -1 : 1;
  // per-point profile normals (averaged over the two neighbouring segments)
  const segN = prof.slice(0, -1).map((p, j) => {
    const dr = prof[j + 1][0] - p[0], dy = prof[j + 1][1] - p[1], l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l] as [number, number];     // (radial, axial)
  });
  const ptN = prof.map((_, j) => {
    const A = segN[Math.max(0, j - 1)], B = segN[Math.min(segN.length - 1, j)];
    const r = A[0] + B[0], y = A[1] + B[1], l = Math.hypot(r, y) || 1;
    return [r / l, y / l] as [number, number];
  });
  const P = (j: number, t: number): V3 => toWorld(f, [prof[j][0] * Math.cos(t), prof[j][1], prof[j][0] * Math.sin(t)]);
  const N = (j: number, t: number): V3 => scale(dirWorld(f, [ptN[j][0] * Math.cos(t), ptN[j][1], ptN[j][0] * Math.sin(t)]), sgn);
  for (let j = 0; j < prof.length - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + (a1 - a0) * i / seg, t1 = a0 + (a1 - a0) * (i + 1) / seg;
      quad4(mb, [P(j, t0), P(j, t1), P(j + 1, t1), P(j + 1, t0)], [N(j, t0), N(j, t1), N(j + 1, t1), N(j + 1, t0)], a);
    }
  }
}

/* flat disc (or ring) perpendicular to the frame's y axis at height h, facing ±y */
export function disc(mb: MeshBuilder, f: Frame3, r: number, h: number, seg: number, a: VertexAttrs, up = true, r0 = 0) {
  const n = scale(f.y, up ? 1 : -1);
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg * Math.PI * 2, t1 = (i + 1) / seg * Math.PI * 2;
    const p = (r: number, t: number) => toWorld(f, [r * Math.cos(t), h, r * Math.sin(t)]);
    if (r0 > 0) quad4(mb, [p(r0, t0), p(r, t0), p(r, t1), p(r0, t1)], [n, n, n, n], a);
    else tri(mb, [toWorld(f, [0, h, 0]), p(r, t0), p(r, t1)], [n, n, n], a, n);
  }
}

/* cylinder from a to b (optionally capped), and tubes along a polyline */
export function cyl(mb: MeshBuilder, a: V3, b: V3, r: number, seg: number, at: VertexAttrs, caps = true, r1 = r) {
  const L = len(sub(b, a));
  if (L < 1e-6) return;
  const f = frameAt(a, sub(b, a));
  lathe(mb, f, [[r, 0], [r1, L]], seg, at);
  if (caps) { disc(mb, f, r, 0, seg, at, false); disc(mb, f, r1, L, seg, at, true); }
}
export function tube(mb: MeshBuilder, pts: V3[], r: number, seg: number, at: VertexAttrs) {
  for (let i = 0; i < pts.length - 1; i++) cyl(mb, pts[i], pts[i + 1], r, seg, at, false);
  for (const p of pts) sphere(mb, p, r, seg, at);
}
export function sphere(mb: MeshBuilder, c: V3, r: number, seg: number, at: VertexAttrs, sy = 1) {
  const rings = Math.max(3, Math.round(seg / 2));
  const prof: [number, number][] = [];
  for (let j = 0; j <= rings; j++) { const t = -Math.PI / 2 + Math.PI * j / rings; prof.push([Math.max(r * Math.cos(t), 1e-5), r * sy * Math.sin(t)]); }
  lathe(mb, frameAt(c), prof, seg, at);
}

/* box with half-extents h, in frame f (rotated boxes for furniture) */
export function boxF(mb: MeshBuilder, f: Frame3, h: V3, at: VertexAttrs, faces = 'px nx py ny pz nz') {
  const F = faces.split(' ');
  const c = (x: number, y: number, z: number) => toWorld(f, [x * h[0], y * h[1], z * h[2]]);
  const face = (key: string, n: V3, pts: [V3, V3, V3, V3]) => { if (F.includes(key)) { const w = dirWorld(f, n); quad4(mb, pts, [w, w, w, w], at); } };
  face('px', [1, 0, 0], [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)]);
  face('nx', [-1, 0, 0], [c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)]);
  face('py', [0, 1, 0], [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)]);
  face('ny', [0, -1, 0], [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)]);
  face('pz', [0, 0, 1], [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)]);
  face('nz', [0, 0, -1], [c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1)]);
}
export const box = (mb: MeshBuilder, c: V3, h: V3, at: VertexAttrs, rotY = 0, faces?: string) =>
  boxF(mb, frameAt(c, [0, 1, 0], [Math.cos(rotY), 0, -Math.sin(rotY)]), h, at, faces);

/* rounded box (cushions, upholstery): a cube grid pushed out to radius r around a shrunk core */
export function roundBox(mb: MeshBuilder, f: Frame3, h: V3, r: number, n: number, at: VertexAttrs, skipBottom = true) {
  const inner: V3 = [Math.max(h[0] - r, 0), Math.max(h[1] - r, 0), Math.max(h[2] - r, 0)];
  const map = (q: V3): [V3, V3] => {
    const c: V3 = [Math.max(-inner[0], Math.min(inner[0], q[0])), Math.max(-inner[1], Math.min(inner[1], q[1])), Math.max(-inner[2], Math.min(inner[2], q[2]))];
    const d = normalize(sub(q, c));
    return [toWorld(f, add(c, scale(d, r))), dirWorld(f, d)];
  };
  const faces: [V3, V3, V3][] = [   // normal, u, v (all of size 1 in unit-cube space)
    [[1, 0, 0], [0, 0, 1], [0, 1, 0]], [[-1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [-1, 0, 0], [0, 1, 0]], [[0, 0, -1], [1, 0, 0], [0, 1, 0]],
  ];
  for (const [nn, u, v] of faces) {
    if (skipBottom && nn[1] < 0) continue;
    const pt = (i: number, j: number): V3 => {
      const s = -1 + 2 * i / n, t = -1 + 2 * j / n;
      return [(nn[0] + u[0] * s + v[0] * t) * h[0], (nn[1] + u[1] * s + v[1] * t) * h[1], (nn[2] + u[2] * s + v[2] * t) * h[2]];
    };
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)].map(map);
      quad4(mb, [q[0][0], q[1][0], q[2][0], q[3][0]], [q[0][1], q[1][1], q[2][1], q[3][1]], at);
    }
  }
}
