/* The forest inside painting № 052 ("Trzy Panie") — CPU side: entering/leaving, the ladies' life
   (blinking, swaying, heads turning and eyes following the visitor — v1 logic), the portal back,
   and per-frame uniforms for forestRender.ts. Built lazily on first entry. */
import type { TgpuRoot } from 'typegpu';
import { d } from 'typegpu';
import type { Renderer } from '../render/renderer.ts';
import { S } from '../game/state.ts';
import { mat4 } from 'wgpu-matrix';
import { setForestWalls } from '../game/player.ts';
import { cameraRay, FOV } from '../game/picking.ts';
import { forestLayout, LADIES, PORTAL, SPAWN, HERO } from './layout.ts';
import { createForestRender } from './forestRender.ts';

export function createForest(root: TgpuRoot, renderer: Renderer, high: boolean) {
  const lay = forestLayout(high ? 150 : 90);
  const gpu = createForestRender(root, renderer, { trunks: lay.trunks, twigs: lay.twigs, bushes: lay.bushes, high });
  let ready = false;
  gpu.warmup().catch(err => console.warn('forest warmup', err)).finally(() => { ready = true; });

  const lady = LADIES.map(([x, z, s], i) => ({ x, z, s, yaw: 0, blinkAt: 2 + i * 1.7, blink: 0, ph: i * 2.1, pupil: [0, 0] as [number, number] }));
  let time = 0;
  /* stepping into the painting: № 052 itself fills the view first, then dissolves into the forest */
  let artT = -1;
  const inv = new Float32Array(16);
  const sun: [number, number, number] = [0.5, 0.3, 0];

  const fwdOf = () => {
    const cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
    return [-Math.sin(S.yaw) * cp, sp, -Math.cos(S.yaw) * cp];
  };

  function writeUniforms(dt: number, aspect: number) {
    const f = fwdOf(), r = [Math.cos(S.yaw), 0, -Math.sin(S.yaw)];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    mat4.invert(renderer.viewProj, inv);
    gpu.forestU.write({
      invViewProj: inv, camRight: d.vec3f(r[0], r[1], r[2]), time,
      camUp: d.vec3f(u[0], u[1], u[2]), dt, camFwd: d.vec3f(f[0], f[1], f[2]), wind: 1,
    });
    gpu.ladies.write(lady.map((L, i) => ({
      pos: d.vec3f(L.x, 0, L.z), s: L.s, yaw: L.yaw, blink: L.blink, pupil: d.vec2f(...L.pupil),
      sway: Math.sin(time * 0.55 + L.ph), pal: i, pad: d.vec2f(),
    })));
    // the bright gap behind the great tree, projected to the screen for the god rays
    const sw = [HERO.x + 0.4, 9.5, HERO.z - 60];
    const v = [sw[0] - S.pos[0], sw[1] - S.pos[1], sw[2] - S.pos[2]];
    const zc = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
    const th = Math.tan(FOV / 2);
    if (zc > 0.1) {
      const nx = (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / (zc * th * aspect), ny = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / (zc * th);
      const vis = Math.max(0, 1 - Math.hypot(nx, ny) * 0.55);
      sun[0] = nx * 0.5 + 0.5; sun[1] = -ny * 0.5 + 0.5; sun[2] = 0.55 * vis;
    } else sun[2] = 0;
  }

  return {
    fog: { color: [1.42, 1.3, 0.94] as [number, number, number], near: 6, far: 42 },
    ambient: [1.0, 0.94, 0.8] as [number, number, number],
    sun,
    enter() {
      S.inForest = true; S.jumpY = 0; S.vy = 0;
      S.pos = [...SPAWN]; S.yaw = 0; S.pitch = 0; S.vel = [0, 0];
      artT = 0;
      setForestWalls(lay.walls);
      renderer.setExtension((pass, refl) => { if (!refl && S.inForest && ready) gpu.draw(pass); });
    },
    exit() { S.inForest = false; artT = -1; },
    /* 1 = only the painting, 0 = only the forest */
    get artMix() {
      if (artT < 0) return 0;
      const k = Math.min(1, Math.max(0, (artT - 0.7) / 2.4));
      return 1 - k * k * (3 - 2 * k);
    },
    update(dt: number, aspect: number) {
      time += dt;
      if (artT >= 0) { artT += Math.min(dt, 0.05); if (artT > 3.2) artT = -1; }
      for (const L of lady) {
        // blink every few seconds
        if (time > L.blinkAt) {
          const ph = time - L.blinkAt;
          L.blink = ph < 0.11 ? ph / 0.11 : Math.max(0, 1 - (ph - 0.11) / 0.13);
          if (ph > 0.24) { L.blink = 0; L.blinkAt = time + 2.5 + Math.random() * 4.5; }
        }
        // the head turns toward the visitor (clamped), the pupils take the rest (v1)
        const hy = 1.5 * L.s;
        const dx = S.pos[0] - L.x, dz = S.pos[2] - L.z;
        let ty = Math.atan2(dx, dz);
        while (ty > Math.PI) ty -= 2 * Math.PI; while (ty < -Math.PI) ty += 2 * Math.PI;
        const cl = Math.max(-0.7, Math.min(0.7, ty));
        L.yaw += (cl - L.yaw) * Math.min(1, dt * 2.2);
        const spill = Math.max(-1, Math.min(1, (ty - L.yaw) * 1.4 + L.yaw * 0.2));
        const pitch = Math.atan2(S.pos[1] - hy, Math.hypot(dx, dz));
        L.pupil = [spill, Math.max(-1, Math.min(1, pitch * 2.2)) * 0.7];
      }
      writeUniforms(dt, aspect);
      if (ready) gpu.simulate();
    },
    atPortal() { return Math.hypot(S.pos[0] - PORTAL[0], S.pos[2] - PORTAL[2]) < 1.3; },
    /* clicking / tapping the floating painting also takes you back */
    click(aspect: number, nx = 0, ny = 0) {
      const { o, d: dir } = cameraRay(nx, ny, aspect);
      if (dir[2] < 1e-3) return false;
      const t = (PORTAL[2] - o[2]) / dir[2];
      if (t < 0 || t > 8) return false;
      const hx = o[0] + dir[0] * t - PORTAL[0], hy = o[1] + dir[1] * t - PORTAL[1];
      return Math.abs(hx) < 0.7 && Math.abs(hy) < 0.9;
    },
    ladiesState() { return lady.map(L => ({ headYaw: +L.yaw.toFixed(3), pupilX: +(L.pupil[0] * 0.011 * L.s).toFixed(4) })); },
    counts: gpu.counts,
    dbg: gpu.dbg,
    get ready() { return ready; },
  };
}
export type Forest = ReturnType<typeof createForest>;
