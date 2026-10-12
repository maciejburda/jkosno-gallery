/* Movement, collision, jumping and the walk-up focus — ported from v1 (3d.html movement / focus code). */
import { walls, rooms, EYE, PLAYER_R, placements, normalOf, type Box } from '../world/layout.ts';
import { KOSNO, type Item } from '../shared/data.ts';
import { S } from './state.ts';
import { track } from './analytics.ts';

export let forestWalls: Box[] = [];
export const setForestWalls = (w: Box[]) => { forestWalls = w; };

export function collide(px: number, pz: number): [number, number] {
  const aw = S.inForest ? forestWalls : walls;
  for (let pass = 0; pass < 2; pass++) {
    for (const w of aw) {
      const x0 = w.x0 - PLAYER_R, x1 = w.x1 + PLAYER_R, z0 = w.z0 - PLAYER_R, z1 = w.z1 + PLAYER_R;
      if (px > x0 && px < x1 && pz > z0 && pz < z1) {
        const dx = Math.min(px - x0, x1 - px), dz = Math.min(pz - z0, z1 - pz);
        if (dx < dz) px = (px - x0 < x1 - px) ? x0 : x1;
        else pz = (pz - z0 < z1 - pz) ? z0 : z1;
      }
    }
  }
  return [px, pz];
}

export function canJump(introHidden: boolean) {
  return introHidden && !S.focusItem && S.jumpY === 0 && S.vy === 0;
}
export function doJump(introHidden: boolean) { if (canJump(introHidden)) S.vy = 4.6; }

export function placementOf(it: Item) { return placements.find(p => p.item === it && p.pickable); }

export function startFocus(it: Item, via = 'click') {
  const p = placementOf(it); if (!p) return;
  track('painting_focus', { painting_id: it.n, painting_title: it.title, via });
  S.jumpY = 0; S.vy = 0;
  const [nx, , nz] = normalOf(p);
  const dist = Math.max(1.35, Math.min(4, Math.max(p.w, p.h) * 1.15 + 0.75));
  const fromYaw = S.yaw, fromPitch = S.pitch;
  const toYaw = Math.atan2(nx, nz);
  let dYaw = toYaw - fromYaw; while (dYaw > Math.PI) dYaw -= 2 * Math.PI; while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
  const toPitch = Math.atan2(p.cy - EYE, dist) * 0.55;
  S.focusItem = it;
  S.focusAnim = { t: 0, from: [...S.pos], to: [p.cx + nx * dist, EYE, p.cz + nz * dist], fromYaw, dYaw, fromPitch, toPitch };
}
export function endFocus() { S.focusItem = null; S.focusAnim = null; }

export function teleportTo(i: number) {
  const r = rooms[i]; if (!r) return false;
  endFocus();
  if (i === 0) { S.pos = [2.2, EYE, 0]; }
  else S.pos = [r.x0 + 1.4, EYE, 0];
  S.yaw = -Math.PI / 2; S.pitch = 0; S.vel = [0, 0];
  return true;
}

/* one simulation step (v1 animate(): focus tween, Q/E, WASD + joystick, damping, collision, jump) */
export function step(dt: number) {
  const fa = S.focusAnim;
  if (fa) {
    fa.t = Math.min(1, fa.t + dt / 0.75);
    const e = 1 - Math.pow(1 - fa.t, 3);
    S.pos = [fa.from[0] + (fa.to[0] - fa.from[0]) * e, fa.from[1] + (fa.to[1] - fa.from[1]) * e, fa.from[2] + (fa.to[2] - fa.from[2]) * e];
    S.yaw = fa.fromYaw + fa.dYaw * e;
    S.pitch = fa.fromPitch + (fa.toPitch - fa.fromPitch) * e;
    if (fa.t >= 1) S.focusAnim = null;
    return;
  }
  if (S.focusItem) return;
  const k = S.keys;
  if (k['KeyQ']) S.yaw += 2.1 * dt;
  if (k['KeyE']) S.yaw -= 2.1 * dt;
  const sp = (k['ShiftLeft'] || k['ShiftRight']) ? 5.6 : 3.1;
  let fw = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
  let st = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);
  fw += -S.moveVec.y; st += S.moveVec.x;
  const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw), rx = Math.cos(S.yaw), rz = -Math.sin(S.yaw);
  const ax = fx * fw + rx * st, az = fz * fw + rz * st;
  const al = Math.hypot(ax, az) || 1;
  S.vel[0] += (ax / al) * sp * dt * 10;
  S.vel[1] += (az / al) * sp * dt * 10;
  const damp = Math.max(0, 1 - dt * 9);
  S.vel[0] *= damp; S.vel[1] *= damp;
  const vl = Math.hypot(S.vel[0], S.vel[1]);
  if (vl > sp) { S.vel[0] *= sp / vl; S.vel[1] *= sp / vl; }
  const [nx, nz] = collide(S.pos[0] + S.vel[0] * dt, S.pos[2] + S.vel[1] * dt);
  if (S.vy !== 0 || S.jumpY > 0) {
    S.vy -= 12.5 * dt; S.jumpY += S.vy * dt;
    if (S.jumpY <= 0) { S.jumpY = 0; S.vy = 0; }
  }
  S.pos = [nx, EYE + S.jumpY, nz];
}

export const findItem = (n: number) => KOSNO.items.find(i => i.n === n);
