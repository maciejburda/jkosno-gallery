/* CPU picking: every painting is an axis-aligned rectangle on a wall, so a ray/rectangle test
   (occluded by the collision walls) replaces THREE.Raycaster. */
import { placements, walls, normalOf, rightOf, type Placement, type Box } from '../world/layout.ts';
import { S } from './state.ts';

export const FOV = 68 * Math.PI / 180;

export function cameraRay(ndcX: number, ndcY: number, aspect: number) {
  const { yaw, pitch } = S;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fwd = [-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const th = Math.tan(FOV / 2);
  const dx = ndcX * th * aspect, dy = ndcY * th;
  const dir = [fwd[0] + right[0] * dx + up[0] * dy, fwd[1] + right[1] * dx + up[1] * dy, fwd[2] + right[2] * dx + up[2] * dy];
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  return { o: [...S.pos] as number[], d: [dir[0] / l, dir[1] / l, dir[2] / l] };
}

/* distance along the ray to the nearest collision wall (walls are full-height in xz) */
function wallHit(o: number[], d: number[], boxes: Box[]): number {
  const hl = Math.hypot(d[0], d[2]);
  if (hl < 1e-6) return Infinity;
  let best = Infinity;
  for (const b of boxes) {
    let t0 = 0, t1 = Infinity;
    for (const [oo, dd, lo, hi] of [[o[0], d[0], b.x0, b.x1], [o[2], d[2], b.z0, b.z1]]) {
      if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) { t0 = Infinity; break; } continue; }
      let a = (lo - oo) / dd, c = (hi - oo) / dd;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    }
    if (t0 <= t1 && t0 > 0.01 && t0 < best) best = t0;
  }
  return best;
}

export interface Hit { p: Placement; distance: number }

export function pick(ndcX: number, ndcY: number, aspect: number, maxDist = 60): Hit | null {
  const { o, d } = cameraRay(ndcX, ndcY, aspect);
  let best: Hit | null = null;
  for (const p of placements) {
    if (!p.pickable) continue;
    const N = normalOf(p), R = rightOf(p);
    const den = d[0] * N[0] + d[1] * N[1] + d[2] * N[2];
    if (den > -1e-4) continue;
    const t = ((p.cx - o[0]) * N[0] + (p.cy - o[1]) * N[1] + (p.cz - o[2]) * N[2]) / den;
    if (t <= 0 || t > maxDist || (best && t >= best.distance)) continue;
    const hx = o[0] + d[0] * t - p.cx, hy = o[1] + d[1] * t - p.cy, hz = o[2] + d[2] * t - p.cz;
    const lx = hx * R[0] + hz * R[2];
    if (Math.abs(lx) <= p.w / 2 && Math.abs(hy) <= p.h / 2) best = { p, distance: t };
  }
  if (best && wallHit(o, d, walls) < best.distance - 0.05) return null;
  return best;
}
