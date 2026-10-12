/* GPU side of the forest inside painting № 052 — everything procedural, everything instanced:
   - sky: the painting's luminous cream/yellow backlight with a rose mist band and faint distant trunks
   - trunks: one cylinder template expanded per instance (bend, taper, lumps, root flare) with swirling
     impasto bark; the great tree of faces and the "owl" trunks carry watching eye-knots
   - ground: a field of brush dabs (golden / rose / olive patches), evaluated per pixel
   - ladies: mosaic veils (Voronoi tesserae) + crisp SDF faces whose eyes follow the visitor
   - vegetation: tens of thousands of brush-dab billboards scattered by a compute shader
   - leaves, golden motes and birds simulated in a compute shader every frame */
import { tgpu, d, std, type TgpuRoot } from 'typegpu';
import { perlin2d, randf } from '@typegpu/noise';
import type { Renderer, PassLike } from '../render/renderer.ts';
import { FC, LADIES, BOUNDS, type TrunkRec } from './layout.ts';

const HDR = 'rgba16float' as const;

export const ForestU = d.struct({
  invViewProj: d.mat4x4f,
  camRight: d.vec3f, time: d.f32,
  camUp: d.vec3f, dt: d.f32,
  camFwd: d.vec3f, wind: d.f32,
});
export const Lady = d.struct({
  pos: d.vec3f, s: d.f32,
  yaw: d.f32, blink: d.f32, pupil: d.vec2f,
  sway: d.f32, pal: d.u32, pad: d.vec2f,
});
const Trunk = d.struct({
  base: d.vec3f, h: d.f32,
  axis: d.vec3f, r: d.f32,
  tint: d.vec3f, taper: d.f32,
  bend: d.f32, seed: d.f32, kind: d.u32, pad: d.f32,
});
const Dab = d.struct({ pos: d.vec3f, size: d.f32, col: d.vec3f, kind: d.f32 });
const Particle = d.struct({ pos: d.vec3f, kind: d.f32, vel: d.vec3f, phase: d.f32 });

const hex = (h: string) => { const v = parseInt(h.slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255].map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); };

/* the ladies' veil palettes (v1) — 3 × 6 colours */
const LADY_PAL = [
  ['#4a86c8', '#d9486a', '#e3c93f', '#e8e0c8', '#c23b2e', '#7fae52'],
  ['#e2703a', '#c23b2e', '#e3c93f', '#d9a75c', '#d9486a', '#f0e3c8'],
  ['#c874b0', '#7fae52', '#4a86c8', '#e8e0c8', '#e2703a', '#d8c8e0'],
].flat().map(h => d.vec3f(...hex(h) as [number, number, number]));
/* bark palette: olive, moss, umber, rose, lavender, ochre, cream, deep brown */
const BARK_PAL = ['#a3a05a', '#7f8a4a', '#7a5a3a', '#d89c9a', '#b4a0c8', '#d8b860', '#efe2c0', '#4e3a26']
  .map(h => d.vec3f(...hex(h) as [number, number, number]));
/* ground dabs: golden, orange, rose, magenta, olive, cream, + rare blue */
const GROUND_PAL = ['#e9c25a', '#e59a4a', '#eaa3b8', '#d0608e', '#a9b06a', '#f2e2b0', '#f0c878', '#5a8ad0']
  .map(h => d.vec3f(...hex(h) as [number, number, number]));
const BUSH_PAL = [
  ['#e7bcd4', '#d787b4', '#c05d92', '#eecfe0', '#e8e0c8', '#f0a8c8'],
  ['#e6a15c', '#d9784a', '#e8c07a', '#c23b2e', '#f0c878', '#e98a5a'],
  ['#a9b06a', '#8a9a4e', '#c7cf8a', '#e3c93f', '#d8d898', '#b8c070'],
].flat().map(h => d.vec3f(...hex(h) as [number, number, number]));

const SKY_TOP = d.vec3f(1.05, 0.98, 0.82);
const SKY_GLOW = d.vec3f(1.55, 1.3, 0.78);
const SKY_ROSE = d.vec3f(1.15, 0.86, 0.9);
const GROUND_WARM = d.vec3f(0.62, 0.42, 0.26);

function cylinderTemplate(sides: number, rings: number) {
  const v: number[] = [];
  for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) {
    const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2, t0 = j / rings, t1 = (j + 1) / rings;
    v.push(a0, t0, a1, t1, a1, t0, a0, t0, a0, t1, a1, t1);
  }
  return new Float32Array(v);
}

export function createForestRender(root: TgpuRoot, r: Renderer, opts: {
  trunks: TrunkRec[]; bushes: [number, number, number, number][]; high: boolean;
}) {
  const { frameAcc, frameMain, finish } = r;
  const cfg = root.with(frameAcc, frameMain);

  /* ---------- resources ---------- */
  const forestU = root.createUniform(ForestU);
  const ladies = root.createUniform(d.arrayOf(Lady, 3));
  const NT = opts.trunks.length;
  const trunks = root.createReadonly(d.arrayOf(Trunk, NT), opts.trunks.map(t => ({
    base: d.vec3f(...t.base), h: t.h, axis: d.vec3f(...t.axis), r: t.r, tint: d.vec3f(...t.tint), taper: t.taper,
    bend: t.bend, seed: t.seed, kind: t.kind, pad: 0,
  })));
  const ladyPal = tgpu.const(d.arrayOf(d.vec3f, 18), LADY_PAL);
  const barkPal = tgpu.const(d.arrayOf(d.vec3f, 8), BARK_PAL);
  const groundPal = tgpu.const(d.arrayOf(d.vec3f, 8), GROUND_PAL);
  const bushPal = tgpu.const(d.arrayOf(d.vec3f, 18), BUSH_PAL);

  const atLayout = tgpu.vertexLayout(d.arrayOf(d.vec2f));
  const SIDES = opts.high ? 16 : 10, RINGS = opts.high ? 40 : 22;
  const cyl = cylinderTemplate(SIDES, RINGS);
  const cylBuf = root.createBuffer(d.arrayOf(d.vec2f, cyl.length / 2)).$usage('vertex');
  cylBuf.write(cyl);
  const cylCount = cyl.length / 2;

  const NDAB = opts.high ? 90000 : 22000;
  const NB = opts.bushes.length;
  const bushes = root.createReadonly(d.arrayOf(d.vec4f, NB), opts.bushes.map(b => d.vec4f(...b)));
  const dabBuf = root.createBuffer(d.arrayOf(Dab, NDAB)).$usage('storage');
  const dabsW = dabBuf.as('mutable');
  const dabsR = dabBuf.as('readonly');

  const NP_LEAF = opts.high ? 420 : 180, NP_MOTE = opts.high ? 1600 : 500, NP_BIRD = 7;
  const NP = NP_LEAF + NP_MOTE + NP_BIRD;
  const partBuf = root.createBuffer(d.arrayOf(Particle, NP)).$usage('storage');
  const partW = partBuf.as('mutable');
  const partR = partBuf.as('readonly');

  /* ---------- shared lighting: the painting's soft, warm, back-lit light ---------- */
  const forestShade = (albedo: d.v3f, N: d.v3f, V: d.v3f) => {
    'use gpu';
    const key = std.normalize(d.vec3f(-0.35, 0.8, 0.5));
    const ndl = std.max(std.dot(N, key), 0);
    const hemi = std.mix(GROUND_WARM, d.vec3f(1.0, 0.95, 0.8), N.y * 0.5 + 0.5);
    const rim = std.pow(1 - std.abs(std.dot(N, V)), 3);
    return albedo * (hemi * 0.78 + ndl * 0.42) + d.vec3f(1.0, 0.85, 0.55) * rim * 0.35;
  };

  /* ---------- sky ---------- */
  const skyVert = tgpu.vertexFn({ in: { vid: d.builtin.vertexIndex }, out: { position: d.builtin.position, ndc: d.vec2f } })((i) => {
    'use gpu';
    const pos = d.arrayOf(d.vec2f, 3)([d.vec2f(-1, -1), d.vec2f(3, -1), d.vec2f(-1, 3)]);
    const p = pos[i.vid];
    return { position: d.vec4f(p, 0, 1), ndc: d.vec2f(p) };
  });
  const skyFrag = tgpu.fragmentFn({ in: { ndc: d.vec2f }, out: d.vec4f })((i) => {
    'use gpu';
    const F = forestU.$;
    const h = F.invViewProj * d.vec4f(i.ndc, 0.5, 1);
    const dir = std.normalize(h.xyz / h.w - frameAcc.$.camPos);
    const el = dir.y;
    const az = std.atan2(dir.x, -dir.z);
    let c = std.mix(SKY_GLOW, SKY_TOP, std.smoothstep(0.02, 0.55, el));
    c = std.mix(c, SKY_ROSE, std.exp(-std.pow((el - 0.04) / 0.06, 2)) * 0.55);
    c = std.mix(c, d.vec3f(1.0, 0.82, 0.5), std.smoothstep(0.0, -0.25, el));
    // the bright opening behind the great tree
    const sun = std.max(std.dot(dir, std.normalize(d.vec3f(0.02, 0.22, -1))), 0);
    c = c + d.vec3f(1.0, 0.86, 0.5) * std.pow(sun, 18) * 0.9;
    // faint, pale distant trunks
    const band = perlin2d.sample(d.vec2f(az * 34, 0.5)) * 0.5 + perlin2d.sample(d.vec2f(az * 71, 3.1)) * 0.35;
    const trunkMask = std.smoothstep(0.18, 0.4, band) * std.smoothstep(0.75, 0.05, el) * std.smoothstep(-0.12, 0.02, el);
    c = std.mix(c, d.vec3f(0.95, 0.78, 0.62), trunkMask * 0.35);
    return d.vec4f(c, 1);
  });
  const skyPipe = cfg.createRenderPipeline({
    vertex: skyVert, fragment: skyFrag, targets: { format: HDR },
    depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'always' },
    multisample: { count: 4 },
  });

  /* ---------- trunks ---------- */
  const trunkVert = tgpu.vertexFn({
    in: { at: d.vec2f, iid: d.builtin.instanceIndex },
    out: { position: d.builtin.position, wpos: d.vec3f, wnrm: d.vec3f, buv: d.vec2f, tint: d.vec3f, kind: d.interpolate('flat', d.u32), seed: d.f32 },
  })((i) => {
    'use gpu';
    const T = trunks.$[i.iid];
    const a = i.at.x;
    const t = i.at.y;
    const ax = T.axis;
    const ref = std.select(d.vec3f(1, 0, 0), d.vec3f(0, 0, 1), std.abs(ax.x) > 0.9);
    const p1 = std.normalize(std.cross(ax, ref));
    const p2 = std.cross(ax, p1);
    const hs = t * T.h;
    const bend = p1 * (std.sin(t * 2.3 + T.seed * 6.28) * T.bend * t) + p2 * (std.cos(t * 1.7 + T.seed * 3.1) * T.bend * 0.7 * t);
    const c = T.base + ax * hs + bend;
    const ground = std.select(d.f32(0), d.f32(1), T.base.y < 0.5);
    const flare = 1 + 0.6 * std.exp(-hs * 1.9) * ground;
    const lumps = 1 + 0.1 * std.sin(hs * 3.1 + T.seed * 20) + 0.07 * std.sin(a * 3 + hs * 1.7 + T.seed * 9) + 0.05 * std.sin(a * 7 - hs * 4.1);
    const rr = T.r * (1 - t * (1 - T.taper)) * lumps * flare;
    const radial = p1 * std.cos(a) + p2 * std.sin(a);
    const wp = c + radial * rr;
    return {
      position: frameAcc.$.viewProj * d.vec4f(wp, 1), wpos: wp, wnrm: radial,
      buv: d.vec2f(a * T.r, hs), tint: T.tint, kind: T.kind, seed: T.seed,
    };
  });

  /* watching eye-knots for the great tree and the "owl" trunks */
  const eyeKnots = tgpu.fn([d.vec2f, d.f32, d.f32], d.vec4f)((uv, seed, density) => {
    'use gpu';
    const g = uv / d.vec2f(0.42, 0.5);
    const cell = std.floor(g);
    randf.seed3(d.vec3f(cell, seed * 97));
    const has = randf.sample() < density;
    const ctr = d.vec2f(0.3 + randf.sample() * 0.4, 0.3 + randf.sample() * 0.4);
    const lp = (g - cell - ctr) * d.vec2f(0.42, 0.5);
    const pair = randf.sample() < 0.55;
    const ex = std.select(d.f32(0), d.f32(0.075), pair);
    const d1 = std.length(lp - d.vec2f(ex, 0));
    const d2 = std.length(lp + d.vec2f(ex, 0));
    const dd = std.min(d1, d2);
    const swirl = std.sin(dd * 95 - std.atan2(lp.y, lp.x) * 1.0) * 0.5 + 0.5;
    const ring = std.smoothstep(0.17, 0.05, dd) * swirl;
    const iris = std.smoothstep(0.045, 0.03, dd);
    const pupil = std.smoothstep(0.022, 0.012, dd);
    return std.select(d.vec4f(0), d.vec4f(ring, iris, pupil, 1), has);
  });

  const barkFrag = tgpu.fragmentFn({
    in: { position: d.builtin.position, wpos: d.vec3f, wnrm: d.vec3f, buv: d.vec2f, tint: d.vec3f, kind: d.interpolate('flat', d.u32), seed: d.f32, front: d.builtin.frontFacing },
    out: d.vec4f,
  })((i) => {
    'use gpu';
    const uv = i.buv;
    const sd = i.seed * 13.7;
    // swirling impasto: domain-warped noise, then quantised into short painted strokes
    const q = uv * d.vec2f(2.4, 1.3);
    const w = q + d.vec2f(perlin2d.sample(q * 0.7 + sd), perlin2d.sample(q * 0.7 + 7.3 + sd)) * 1.7;
    const s = perlin2d.sample(w * 1.15);
    const swirl = std.sin(s * 10 + std.length(w) * 0.6) * 0.5 + 0.5;
    // short strokes that follow the swirl, ~1.5 × 4 cm
    const sv = uv + d.vec2f(swirl * 0.06, s * 0.05);
    const cell = std.floor(d.vec2f(sv.x * 64 + std.floor(sv.y * 26) * 0.5, sv.y * 26));
    randf.seed3(d.vec3f(cell, sd));
    const r1 = randf.sample();
    const r2 = randf.sample();
    const k = d.u32(std.floor(std.fract(r1 + swirl * 0.35) * 8));
    let col = std.mix(i.tint * 0.42, i.tint * 1.15, swirl);
    col = std.mix(col, barkPal.$[std.min(k, d.u32(7))], 0.3 + r2 * 0.28);
    col = col * (1 - std.smoothstep(0.72, 0.95, std.sin(s * 23 + w.x) * 0.5 + 0.5) * 0.45);
    col = col * (0.9 + perlin2d.sample(uv * d.vec2f(40, 12)) * 0.12);
    if (i.kind > 0) {
      const hero = i.kind === 2;
      const ek = eyeKnots(uv * std.select(d.f32(1), d.f32(0.55), hero), i.seed, std.select(d.f32(0.16), d.f32(0.8), hero));
      col = std.mix(col, col * 0.45 + d.vec3f(0.05, 0.035, 0.02), ek.x * 0.85);
      col = std.mix(col, d.vec3f(0.93, 0.86, 0.66), ek.y * 0.85);
      col = std.mix(col, d.vec3f(0.08, 0.06, 0.05), ek.z);
    }
    let N = std.normalize(i.wnrm);
    if (!i.front) { N = N * -1; }
    // painted relief
    N = std.normalize(N + d.vec3f(0, (swirl - 0.5) * 0.25, 0));
    const V = std.normalize(frameAcc.$.camPos - i.wpos);
    return d.vec4f(finish(forestShade(col, N, V), i.wpos), 1);
  });
  const trunkPipe = cfg.createRenderPipeline({
    attribs: { at: atLayout.attrib }, vertex: trunkVert, fragment: barkFrag, targets: { format: HDR },
    primitive: { cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: 4 },
  });

  /* ---------- ground: a field of brush dabs ---------- */
  const groundVert = tgpu.vertexFn({ in: { vid: d.builtin.vertexIndex }, out: { position: d.builtin.position, wpos: d.vec3f } })((i) => {
    'use gpu';
    const c = d.arrayOf(d.vec2f, 6)([d.vec2f(-1, -1), d.vec2f(1, 1), d.vec2f(1, -1), d.vec2f(-1, -1), d.vec2f(-1, 1), d.vec2f(1, 1)]);
    const p = c[i.vid] * (BOUNDS + 12);
    const wp = d.vec3f(FC[0] + p.x, 0, FC[2] + p.y);
    return { position: frameAcc.$.viewProj * d.vec4f(wp, 1), wpos: wp };
  });
  const groundFrag = tgpu.fragmentFn({ in: { wpos: d.vec3f }, out: d.vec4f })((i) => {
    'use gpu';
    const p = i.wpos.xz;
    const z1 = perlin2d.sample(p * 0.12);
    const z2 = perlin2d.sample(p * 0.19 + 9.1);
    const g = p / 0.085;
    const cell = std.floor(g);
    let col = std.mix(groundPal.$[0], groundPal.$[6], perlin2d.sample(p * 0.7) * 0.5 + 0.5);
    let best = d.f32(-1);
    for (const oy of tgpu.unroll([-1, 0, 1])) {
      for (const ox of tgpu.unroll([-1, 0, 1])) {
        const c = cell + d.vec2f(ox, oy);
        randf.seed2(c);
        const ctr = c + d.vec2f(randf.sample(), randf.sample());
        const ang = randf.sample() * 3.1416;
        const prio = randf.sample();
        const pick = randf.sample();
        const lp = g - ctr;
        const ca = std.cos(ang);
        const sa = std.sin(ang);
        const rp = d.vec2f(lp.x * ca + lp.y * sa, -lp.x * sa + lp.y * ca);
        const dist = std.length(rp / d.vec2f(0.95, 0.38));
        if (dist < 1 && prio > best) {
          best = prio;
          // zone palettes: rose patches, olive patches, golden-orange elsewhere (+ rare blue/magenta)
          let k = d.u32(std.select(d.f32(0), d.f32(1), pick > 0.55));
          if (z1 > 0.22) { k = d.u32(std.select(d.f32(2), d.f32(3), pick > 0.6)); }
          else if (z2 > 0.28) { k = d.u32(std.select(d.f32(4), d.f32(6), pick > 0.5)); }
          if (pick > 0.985) { k = 7; }
          else if (pick > 0.93) { k = 5; }
          col = groundPal.$[k] * (0.88 + prio * 0.2);
        }
      }
    }
    const V = std.normalize(frameAcc.$.camPos - i.wpos);
    return d.vec4f(finish(forestShade(col, d.vec3f(0, 1, 0), V), i.wpos), 1);
  });
  const groundPipe = cfg.createRenderPipeline({
    vertex: groundVert, fragment: groundFrag, targets: { format: HDR },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: 4 },
  });

  /* ---------- the ladies: mosaic veils ---------- */
  const veilVert = tgpu.vertexFn({
    in: { at: d.vec2f, iid: d.builtin.instanceIndex },
    out: { position: d.builtin.position, wpos: d.vec3f, wnrm: d.vec3f, muv: d.vec2f, lady: d.interpolate('flat', d.u32), ang: d.f32 },
  })((i) => {
    'use gpu';
    const L = ladies.$[i.iid];
    const a = i.at.x;
    const t = i.at.y;
    const H = 2.05 * L.s;
    const R0 = 0.62 * L.s;
    const prof = std.pow(1 - t, 0.85) * (1 + 0.05 * std.sin(a * 5 + t * 7 + L.sway * 3)) + 0.06 * std.smoothstep(0.75, 1.0, t);
    const rr = R0 * prof * (1 + 0.08 * std.sin(t * 9.0 + a * 2));
    const sway = L.sway * t * t * 0.12;
    const wp = L.pos + d.vec3f(std.cos(a) * rr + sway, t * H, std.sin(a) * rr);
    const n = std.normalize(d.vec3f(std.cos(a), R0 / H * 0.8, std.sin(a)));
    return { position: frameAcc.$.viewProj * d.vec4f(wp, 1), wpos: wp, wnrm: n, muv: d.vec2f(a * R0, t * H), lady: i.iid, ang: a };
  });
  const veilFrag = tgpu.fragmentFn({
    in: { wpos: d.vec3f, wnrm: d.vec3f, muv: d.vec2f, lady: d.interpolate('flat', d.u32), ang: d.f32 },
    out: d.vec4f,
  })((i) => {
    'use gpu';
    const L = ladies.$[i.lady];
    // Voronoi tesserae, ~5 cm
    const g = i.muv / 0.05;
    const cell = std.floor(g);
    let d1 = d.f32(9);
    let d2 = d.f32(9);
    let id = d.vec2f(0);
    for (const oy of tgpu.unroll([-1, 0, 1])) {
      for (const ox of tgpu.unroll([-1, 0, 1])) {
        const c = cell + d.vec2f(ox, oy);
        randf.seed3(d.vec3f(c, d.f32(i.lady)));
        const p = c + d.vec2f(0.15 + randf.sample() * 0.7, 0.15 + randf.sample() * 0.7);
        const dd = std.length(g - p);
        if (dd < d1) { d2 = d1; d1 = dd; id = d.vec2f(c); }
        else if (dd < d2) { d2 = dd; }
      }
    }
    randf.seed3(d.vec3f(id, d.f32(i.lady) + 0.5));
    const k = d.u32(std.floor(randf.sample() * 6));
    let col = ladyPal.$[L.pal * 6 + std.min(k, d.u32(5))] * (0.85 + randf.sample() * 0.3);
    const grout = std.smoothstep(0.02, 0.09, d2 - d1);
    col = std.mix(col * 0.55, col, grout);
    // long orange hair falling over the front of the veil
    const front = std.cos(i.ang - (L.yaw + Math.PI * 0.5));
    const hairH = 2.05 * L.s;
    const hair = std.smoothstep(0.55, 0.85, i.muv.y / hairH) * std.smoothstep(0.2, 0.75, front) * (0.7 + 0.3 * std.sin(i.ang * 40));
    col = std.mix(col, d.vec3f(0.82, 0.36, 0.1), std.clamp(hair, 0, 1));
    const V = std.normalize(frameAcc.$.camPos - i.wpos);
    return d.vec4f(finish(forestShade(col, std.normalize(i.wnrm), V), i.wpos), 1);
  });
  const veilPipe = cfg.createRenderPipeline({
    attribs: { at: atLayout.attrib }, vertex: veilVert, fragment: veilFrag, targets: { format: HDR },
    primitive: { cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: 4 },
  });

  /* ---------- the ladies' faces: SDF billboards that turn toward the visitor ---------- */
  const faceVert = tgpu.vertexFn({
    in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
    out: { position: d.builtin.position, fuv: d.vec2f, wpos: d.vec3f, lady: d.interpolate('flat', d.u32) },
  })((i) => {
    'use gpu';
    const c = d.arrayOf(d.vec2f, 6)([d.vec2f(-1, -1), d.vec2f(1, -1), d.vec2f(1, 1), d.vec2f(-1, -1), d.vec2f(1, 1), d.vec2f(-1, 1)]);
    const L = ladies.$[i.iid];
    const q = c[i.vid];
    const s = L.s;
    const right = d.vec3f(std.cos(L.yaw), 0, -std.sin(L.yaw));
    const fwd = d.vec3f(std.sin(L.yaw), 0, std.cos(L.yaw));
    const head = L.pos + d.vec3f(L.sway * 0.12, 1.5 * s, 0) + fwd * (0.26 * s);
    const wp = head + right * (q.x * 0.2 * s) + d.vec3f(0, q.y * 0.22 * s, 0);
    return { position: frameAcc.$.viewProj * d.vec4f(wp, 1), fuv: q, wpos: wp, lady: i.iid };
  });
  const ellipse = tgpu.fn([d.vec2f, d.vec2f], d.f32)((p, r) => {
    'use gpu';
    return (std.length(p / r) - 1) * std.min(r.x, r.y);
  });
  const faceFrag = tgpu.fragmentFn({ in: { fuv: d.vec2f, wpos: d.vec3f, lady: d.interpolate('flat', d.u32) }, out: d.vec4f })((i) => {
    'use gpu';
    const L = ladies.$[i.lady];
    const p = d.vec2f(i.fuv.x * 0.2, i.fuv.y * 0.22);
    const aa = std.fwidth(p.x) * 1.2;
    const hairD = ellipse(p - d.vec2f(0, 0.025), d.vec2f(0.17, 0.19));
    const faceD = ellipse(p - d.vec2f(0, -0.01), d.vec2f(0.105, 0.135));
    let col = d.vec3f(0.85, 0.4, 0.12) * (0.9 + 0.1 * std.sin(p.x * 160));
    let alpha = std.smoothstep(aa, -aa, hairD);
    col = std.mix(col, d.vec3f(0.96, 0.86, 0.7), std.smoothstep(aa, -aa, faceD));
    // eyes: white + pupils that follow the visitor; blinking squashes them
    const open = std.max(1 - L.blink, 0.06);
    for (const sx of tgpu.unroll([-1, 1])) {
      const ec = d.vec2f(sx * 0.045, 0.018);
      const ep = (p - ec) / d.vec2f(1, open);
      const white = std.smoothstep(aa, -aa, std.length(ep) - 0.021);
      col = std.mix(col, d.vec3f(1, 0.98, 0.94), white);
      const pp = ep - L.pupil * 0.011;
      const pupil = std.smoothstep(aa, -aa, std.length(pp) - 0.0105) * white;
      col = std.mix(col, d.vec3f(0.12, 0.09, 0.06), pupil);
      // lid line
      col = std.mix(col, d.vec3f(0.55, 0.32, 0.2), std.smoothstep(aa * 1.5, 0, std.abs(std.length(ep) - 0.022)) * 0.6);
    }
    const mouth = std.smoothstep(aa, -aa, ellipse(p - d.vec2f(0, -0.06), d.vec2f(0.02, 0.006)));
    col = std.mix(col, d.vec3f(0.72, 0.32, 0.25), mouth);
    if (alpha < 0.02) { std.discard(); }
    return d.vec4f(finish(col * 1.05, i.wpos), alpha);
  });
  const facePipe = cfg.createRenderPipeline({
    vertex: faceVert, fragment: faceFrag, targets: { format: HDR },
    primitive: { cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: 4, alphaToCoverageEnabled: true },
  });

  /* ---------- vegetation: brush dabs scattered once by a compute shader ---------- */
  const scatter = root.createGuardedComputePipeline((x) => {
    'use gpu';
    randf.seed2(d.vec2f(d.f32(x), 17.3));
    const isBush = randf.sample() < 0.38;
    let pos = d.vec3f(0);
    let size = d.f32(0.1);
    let col = d.vec3f(1);
    let kind = d.f32(0);
    if (isBush) {
      const b = bushes.$[d.u32(std.floor(randf.sample() * NB)) % NB];
      const s = b.z;
      const ang = randf.sample() * 6.2832;
      const rr = std.sqrt(randf.sample()) * 0.62 * s;
      const hy = (1 - (rr / (0.62 * s)) * (rr / (0.62 * s))) * 0.85 * s * randf.sample() + 0.05;
      pos = d.vec3f(b.x + std.cos(ang) * rr, hy, b.y + std.sin(ang) * rr);
      size = (0.05 + randf.sample() * 0.07) * (0.7 + s * 0.3);
      col = d.vec3f(bushPal.$[d.u32(b.w) * 6 + d.u32(std.floor(randf.sample() * 5.99))]);
      kind = 2;
    } else {
      const ang = randf.sample() * 6.2832;
      const rr = std.sqrt(randf.sample()) * (BOUNDS - 1);
      pos = d.vec3f(FC[0] + std.cos(ang) * rr, 0, FC[2] + std.sin(ang) * rr);
      const tall = randf.sample();
      size = 0.035 + tall * tall * 0.11;
      const zone = perlin2d.sample(pos.xz * 0.12);
      const pick = randf.sample();
      let k = d.u32(std.select(d.f32(0), d.f32(1), pick > 0.5));
      if (zone > 0.22) { k = d.u32(std.select(d.f32(2), d.f32(3), pick > 0.65)); }
      if (pick > 0.988) { k = 7; }
      col = groundPal.$[k] * (0.85 + randf.sample() * 0.25);
      kind = std.select(d.f32(1), d.f32(0), tall > 0.55);
    }
    dabsW.$[x] = Dab({ pos, size, col, kind });
  });
  scatter.dispatchThreads(NDAB);

  const dabVert = tgpu.vertexFn({
    in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
    out: { position: d.builtin.position, quv: d.vec2f, col: d.vec3f, wpos: d.vec3f, kind: d.interpolate('flat', d.f32) },
  })((i) => {
    'use gpu';
    const c = d.arrayOf(d.vec2f, 6)([d.vec2f(-1, 0), d.vec2f(1, 0), d.vec2f(1, 1), d.vec2f(-1, 0), d.vec2f(1, 1), d.vec2f(-1, 1)]);
    const D = dabsR.$[i.iid];
    const q = c[i.vid];
    const F = forestU.$;
    // grass strokes stand up (cylindrical billboard), flower/bush dabs face the camera
    const toCam = frameAcc.$.camPos - D.pos;
    const right = std.normalize(d.vec3f(toCam.z, 0, -toCam.x));
    const tall = D.kind < 0.5;
    const hgt = std.select(D.size * 1.1, D.size * 2.6, tall);
    const wid = std.select(D.size * 1.2, D.size * 0.32, tall);
    const upv = std.select(F.camUp, d.vec3f(0, 1, 0), tall);
    const base = std.select(D.pos - F.camUp * (hgt * 0.5), D.pos, tall);
    const sway = std.sin(F.time * 1.4 + D.pos.x * 0.6 + D.pos.z * 0.4) * F.wind * q.y * hgt * 0.35;
    const wp = base + right * (q.x * wid + sway) + upv * (q.y * hgt);
    return { position: frameAcc.$.viewProj * d.vec4f(wp, 1), quv: d.vec2f(q.x, q.y * 2 - 1), col: D.col, wpos: wp, kind: D.kind };
  });
  const dabFrag = tgpu.fragmentFn({ in: { quv: d.vec2f, col: d.vec3f, wpos: d.vec3f, kind: d.interpolate('flat', d.f32) }, out: d.vec4f })((i) => {
    'use gpu';
    // a ragged brush dab
    const n = perlin2d.sample(i.quv * 3.1 + i.wpos.xz * 7) * 0.25;
    const dist = std.length(i.quv) + n;
    const alpha = std.smoothstep(1.0, 0.75, dist);
    if (alpha < 0.03) { std.discard(); }
    const shade = 0.85 + 0.15 * (i.quv.y * 0.5 + 0.5);
    const V = std.normalize(frameAcc.$.camPos - i.wpos);
    return d.vec4f(finish(forestShade(i.col * shade, d.vec3f(0, 1, 0), V), i.wpos), alpha);
  });
  const dabPipe = cfg.createRenderPipeline({
    vertex: dabVert, fragment: dabFrag, targets: { format: HDR },
    primitive: { cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: 4, alphaToCoverageEnabled: true },
  });

  /* ---------- leaves, golden motes and birds: simulated on the GPU ---------- */
  const initParticles = root.createGuardedComputePipeline((x) => {
    'use gpu';
    randf.seed2(d.vec2f(d.f32(x), 3.7));
    const kind = std.select(std.select(d.f32(2), d.f32(1), x < NP_LEAF + NP_MOTE), d.f32(0), x < NP_LEAF);
    const pos = d.vec3f(FC[0] + (randf.sample() - 0.5) * 36, randf.sample() * 7 + 0.3, FC[2] - 2 + (randf.sample() - 0.5) * 36);
    partW.$[x] = Particle({ pos, kind, vel: d.vec3f(randf.sample() * 6 + 6, randf.sample() * 2.5 + 3, (randf.sample() * 0.15 + 0.15) * std.sign(randf.sample() - 0.5)), phase: randf.sample() * 6.28 });
  });
  initParticles.dispatchThreads(NP);
  const stepParticles = root.createGuardedComputePipeline((x) => {
    'use gpu';
    const F = forestU.$;
    const p = Particle(partW.$[x]);
    let pos = d.vec3f(p.pos);
    if (p.kind < 0.5) {
      // maple leaves: fall, flutter, drift
      pos = pos + d.vec3f(std.sin(F.time * 1.3 + p.phase) * 0.35 + 0.08, -(0.42 + std.sin(p.phase) * 0.1), std.cos(F.time * 0.9 + p.phase * 2) * 0.2) * F.dt;
      if (pos.y < 0.08) {
        randf.seed3(d.vec3f(d.f32(x), F.time, 1));
        pos = d.vec3f(FC[0] + (randf.sample() - 0.5) * 36, 6 + randf.sample() * 3, FC[2] - 2 + (randf.sample() - 0.5) * 36);
      }
    } else if (p.kind < 1.5) {
      // golden dust drifting up in the light
      pos = pos + d.vec3f(std.sin(F.time * 0.9 + p.phase) * 0.12, 0.16 + std.sin(p.phase * 3) * 0.04, std.cos(F.time * 0.7 + p.phase) * 0.1) * F.dt;
      if (pos.y > 6.5) { pos = d.vec3f(pos.x, 0.25, pos.z); }
    } else {
      // birds circling between the trunks (analytic orbit: vel = radius, height, speed)
      const a = F.time * p.vel.z + p.phase;
      pos = d.vec3f(FC[0] + std.cos(a) * p.vel.x, p.vel.y + std.sin(F.time * 1.3 + p.phase) * 0.35, FC[2] - 4 + std.sin(a) * p.vel.x * 0.7);
    }
    partW.$[x] = Particle({ pos, kind: p.kind, vel: p.vel, phase: p.phase });
  });

  const partVert = tgpu.vertexFn({
    in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
    out: { position: d.builtin.position, quv: d.vec2f, kind: d.interpolate('flat', d.f32), wpos: d.vec3f, tint: d.f32 },
  })((i) => {
    'use gpu';
    const c = d.arrayOf(d.vec2f, 6)([d.vec2f(-1, -1), d.vec2f(1, -1), d.vec2f(1, 1), d.vec2f(-1, -1), d.vec2f(1, 1), d.vec2f(-1, 1)]);
    const P = partR.$[i.iid];
    const F = forestU.$;
    const q = c[i.vid];
    let wp = d.vec3f(P.pos);
    if (P.kind < 0.5) {
      // tumbling leaf
      const a = F.time * 1.7 + P.phase;
      const ax1 = std.normalize(d.vec3f(std.cos(a), std.sin(a * 0.7), std.sin(a)));
      const ax2 = std.normalize(std.cross(ax1, d.vec3f(0.3, 1, 0.2)));
      wp = wp + (ax1 * q.x + ax2 * q.y) * 0.07;
    } else if (P.kind < 1.5) {
      wp = wp + (F.camRight * q.x + F.camUp * q.y) * 0.03;
    } else {
      // bird: flapping V in its flight direction
      const a = F.time * P.vel.z + P.phase;
      const dir = d.vec3f(-std.sin(a), 0, std.cos(a) * 0.7);
      const side = std.normalize(std.cross(dir, d.vec3f(0, 1, 0)));
      const flap = std.sin(F.time * 9 + P.phase) * 0.6;
      wp = wp + side * (q.x * 0.17) + d.vec3f(0, std.abs(q.x) * flap * 0.1 + q.y * 0.02, 0);
    }
    return { position: frameAcc.$.viewProj * d.vec4f(wp, 1), quv: q, kind: P.kind, wpos: wp, tint: std.fract(P.phase) };
  });
  const partFrag = tgpu.fragmentFn({ in: { quv: d.vec2f, kind: d.interpolate('flat', d.f32), wpos: d.vec3f, tint: d.f32 }, out: d.vec4f })((i) => {
    'use gpu';
    const q = i.quv;
    let col = d.vec3f(0);
    let alpha = d.f32(0);
    if (i.kind < 0.5) {
      // maple leaf: five lobes
      const ang = std.atan2(q.y, q.x);
      const rad = 0.62 + 0.3 * std.cos(ang * 5) - 0.1 * std.cos(ang * 10);
      alpha = std.smoothstep(rad, rad - 0.12, std.length(q));
      col = std.mix(d.vec3f(0.85, 0.3, 0.08), d.vec3f(0.78, 0.12, 0.08), i.tint);
      col = std.mix(col, d.vec3f(0.9, 0.6, 0.18), std.smoothstep(0.66, 1, i.tint)) * 1.1;
    } else if (i.kind < 1.5) {
      alpha = std.exp(-std.dot(q, q) * 3.5) * 0.9;
      col = d.vec3f(2.6, 2.1, 1.1);
    } else {
      const v = std.abs(q.y - std.abs(q.x) * 0.4);
      alpha = std.smoothstep(0.32, 0.12, v);
      col = d.vec3f(0.22, 0.16, 0.1);
    }
    if (alpha < 0.03) { std.discard(); }
    return d.vec4f(finish(col, i.wpos), alpha);
  });
  const partPipe = cfg.createRenderPipeline({
    vertex: partVert, fragment: partFrag, targets: { format: HDR },
    primitive: { cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: 4, alphaToCoverageEnabled: true },
  });

  const pipes = [skyPipe, trunkPipe, groundPipe, veilPipe, facePipe, dabPipe, partPipe];

  return {
    forestU, ladies,
    async warmup() { await Promise.all(pipes.map(p => p.initAsync())); },
    simulate() { stepParticles.dispatchThreads(NP); },
    draw(pass: PassLike) {
      skyPipe.with(pass).draw(3);
      groundPipe.with(pass).draw(6);
      trunkPipe.with(atLayout, cylBuf).with(pass).draw(cylCount, NT);
      veilPipe.with(atLayout, cylBuf).with(pass).draw(cylCount, LADIES.length);
      facePipe.with(pass).draw(6, LADIES.length);
      dabPipe.with(pass).draw(6, NDAB);
      partPipe.with(pass).draw(6, NP);
    },
    counts: { trunks: NT, dabs: NDAB, particles: NP },
  };
}
export type ForestRender = ReturnType<typeof createForestRender>;
