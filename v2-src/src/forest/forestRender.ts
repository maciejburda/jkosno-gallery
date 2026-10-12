/* GPU side of the forest inside painting № 052 — everything procedural, everything instanced:
   - sky: the painting's blown-out lemon/cream backlight, green and rose haze, a lake glinting between
     the trunks, faint distant trunks
   - trunks: one cylinder template expanded per instance (bend, taper, lumps, root flare, the pollards'
     knobbly heads) with impasto bark (bark.ts); the great tree is covered with watching faces;
     limbs, twigs and willow whips use a second, low-poly template
   - ground: a pointillist field of brush dabs, evaluated per pixel
   - the three ladies (ladies.ts): bell-shaped figures with painted faces, copper hair, mosaic cloaks
   - vegetation: tens of thousands of brush-dab billboards scattered by a compute shader
     (grass strokes, flowering mounds, the ladies' hems dissolving into the meadow)
   - leaves, golden motes and colourful birds simulated in a compute shader every frame */
import { tgpu, d, std, type TgpuRoot } from 'typegpu';
import { perlin2d, randf } from '@typegpu/noise';
import type { Renderer, PassLike } from '../render/renderer.ts';
import { FC, LADIES, BOUNDS, SPAWN, HERO, TK, type TrunkRec } from './layout.ts';
import { bakeBark, barkFromWeights, BARK_TILE, twigColor, faceCrowd, forkMask, willowFace, vec } from './bark.ts';
import { LADY_H, ladyRadius, ladyColor, cloakPal } from './ladies.ts';

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
  bend: d.f32, seed: d.f32, kind: d.u32, fam: d.u32,
});
const Dab = d.struct({ pos: d.vec3f, size: d.f32, col: d.vec3f, kind: d.f32 });
const Particle = d.struct({ pos: d.vec3f, kind: d.f32, vel: d.vec3f, phase: d.f32 });

/* ground dabs: lemon, ochre-orange, pink, magenta, olive, cream, golden, lavender-blue */
const GROUND_PAL = ['#f2d45a', '#eba84a', '#f2a8bc', '#d8608e', '#b0b46a', '#f6ecc8', '#f2c060', '#8a8ae0'].map(vec);
/* flowering mounds: pink heather, amber, olive, lavender-blue, dry grass */
const BUSH_PAL = [
  ['#e98fb4', '#d8679a', '#f2b6cc', '#c8528a', '#f6d2de', '#e9a0a8'],
  ['#f0a050', '#e27a3a', '#f4c070', '#d8562e', '#f6d690', '#eb9060'],
  ['#a9b06a', '#8a9a4e', '#c7cf8a', '#e3c93f', '#d8d898', '#b8c070'],
  ['#9a94e0', '#7a86d8', '#b8a8e8', '#6a7ad0', '#d0c4f0', '#e8a0c8'],
  ['#c89a50', '#a87a3a', '#d8b068', '#8a6030', '#e8c888', '#b88a48'],
].flat().map(vec);
const BIRD_PAL = ['#e2522a', '#4a78d0', '#9a5ac2', '#f08a2a'].map(vec);

const SKY_TOP = d.vec3f(1.2, 1.12, 0.84);
const SKY_GLOW = d.vec3f(1.7, 1.52, 1.0);
const SKY_ROSE = d.vec3f(1.35, 1.04, 1.02);
const HAZE_GREEN = d.vec3f(1.12, 1.24, 0.66);
const LAKE = d.vec3f(0.92, 1.1, 1.28);
const LAKE_ROSE = d.vec3f(1.3, 1.02, 1.08);
const TRUNK_FAR = d.vec3f(1.12, 0.94, 0.92);

/* indexed cylinder template: (sides+1)×(rings+1) unique vertices, so each is shaded once */
function cylinderTemplate(sides: number, rings: number) {
  const v: number[] = [];
  for (let j = 0; j <= rings; j++) for (let i = 0; i <= sides; i++) v.push(i / sides * Math.PI * 2, j / rings);
  const idx: number[] = [];
  const at = (i: number, j: number) => j * (sides + 1) + i;
  for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) {
    idx.push(at(i, j), at(i + 1, j + 1), at(i + 1, j), at(i, j), at(i, j + 1), at(i + 1, j + 1));
  }
  return { verts: new Float32Array(v), idx };
}

export function createForestRender(root: TgpuRoot, r: Renderer, opts: {
  trunks: TrunkRec[]; twigs: TrunkRec[]; bushes: [number, number, number, number][]; high: boolean;
}) {
  const { frameAcc, frameMain, finish, sRepeat } = r;
  // cached Perlin gradients (256² lattice) — the bark, ground and dabs sample noise a lot
  const noiseCache = perlin2d.staticCache({ root, size: d.vec2u(256, 256) });
  const cfg = root.with(frameAcc, frameMain).pipe(noiseCache.inject());

  /* ---------- resources ---------- */
  const forestU = root.createUniform(ForestU);
  const ladies = root.createUniform(d.arrayOf(Lady, 3));
  const NT = opts.trunks.length, NTW = opts.twigs.length;
  const all = [...opts.trunks, ...opts.twigs];
  const trunks = root.createReadonly(d.arrayOf(Trunk, all.length), all.map(t => ({
    base: d.vec3f(...t.base), h: t.h, axis: d.vec3f(...t.axis), r: t.r, tint: d.vec3f(...t.tint), taper: t.taper,
    bend: t.bend, seed: t.seed, kind: t.kind, fam: t.fam,
  })));
  const barkTex = bakeBark(root, opts.high ? 2048 : 1024);
  const groundPal = tgpu.const(d.arrayOf(d.vec3f, 8), GROUND_PAL);
  const bushPal = tgpu.const(d.arrayOf(d.vec3f, 30), BUSH_PAL);
  const birdPal = tgpu.const(d.arrayOf(d.vec3f, 4), BIRD_PAL);
  const ladyAt = tgpu.const(d.arrayOf(d.vec4f, 3), LADIES.map(([x, z, s]) => d.vec4f(x, 0, z, s)));

  const atLayout = tgpu.vertexLayout(d.arrayOf(d.vec2f));
  const template = (sides: number, rings: number) => {
    const t = cylinderTemplate(sides, rings);
    const buf = root.createBuffer(d.arrayOf(d.vec2f, t.verts.length / 2)).$usage('vertex');
    buf.write(t.verts);
    const idx = root.createBuffer(d.arrayOf(d.u16, t.idx.length), t.idx).$usage('index');
    return { buf, idx, count: t.idx.length };
  };
  const cyl = opts.high ? template(16, 40) : template(10, 22);
  const twig = template(6, 4);
  const ladyMesh = opts.high ? template(48, 72) : template(28, 44);
  /* billboards: 4 corners + 6 indices instead of 6 vertices each */
  const quadIdx = root.createBuffer(d.arrayOf(d.u16, 6), [0, 1, 2, 0, 2, 3]).$usage('index');

  const NDAB = opts.high ? 90000 : 22000;
  const NB = opts.bushes.length;
  const bushes = root.createReadonly(d.arrayOf(d.vec4f, NB), opts.bushes.map(b => d.vec4f(...b)));
  const dabBuf = root.createBuffer(d.arrayOf(Dab, NDAB)).$usage('storage');
  const dabsW = dabBuf.as('mutable');
  const dabsR = dabBuf.as('readonly');

  const NP_LEAF = opts.high ? 420 : 180, NP_MOTE = opts.high ? 1600 : 500, NP_BIRD = 14;
  const NP = NP_LEAF + NP_MOTE + NP_BIRD;
  const partBuf = root.createBuffer(d.arrayOf(Particle, NP)).$usage('storage');
  const partW = partBuf.as('mutable');
  const partR = partBuf.as('readonly');

  /* ---------- shared lighting: the painting's soft, warm light streaming from behind the grove ---------- */
  const forestShade = (albedo: d.v3f, N: d.v3f, V: d.v3f) => {
    'use gpu';
    const sunDir = std.normalize(d.vec3f(0.15, 0.5, -0.85));
    const wrap = std.max(std.dot(N, sunDir) * 0.6 + 0.4, 0);
    const hemi = std.mix(d.vec3f(0.92, 0.7, 0.48), d.vec3f(1.05, 1.0, 0.86), N.y * 0.5 + 0.5);
    const back = std.max(-std.dot(V, sunDir), 0);
    const rim = std.pow(1 - std.abs(std.dot(N, V)), 2.5) * (0.35 + 0.65 * back);
    return albedo * (hemi * 0.74 + wrap * 0.36) + d.vec3f(1.0, 0.88, 0.6) * rim * 0.45;
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
    let c = std.mix(SKY_GLOW, SKY_TOP, std.smoothstep(0.02, 0.6, el));
    // green-yellow haze low on the left, rose haze bands
    c = std.mix(c, HAZE_GREEN, std.exp(-std.pow((el - 0.07) / 0.11, 2)) * std.smoothstep(0.4, -0.9, az) * 0.45);
    c = std.mix(c, SKY_ROSE, std.exp(-std.pow((el - 0.15) / 0.05, 2)) * 0.3);
    c = std.mix(c, SKY_ROSE, std.exp(-std.pow((el - 0.035) / 0.03, 2)) * 0.35);
    // the bright opening behind the great tree
    const sun = std.max(std.dot(dir, std.normalize(d.vec3f(0.02, 0.22, -1))), 0);
    c = c + d.vec3f(1.0, 0.86, 0.5) * std.pow(sun, 18) * 0.9;
    // faint, pale distant trunks (mirrored in the lake)
    const ae = std.abs(el);
    const band = perlin2d.sample(d.vec2f(az * 34, 0.5)) * 0.5 + perlin2d.sample(d.vec2f(az * 71, 3.1)) * 0.35;
    const trunkMask = std.smoothstep(0.18, 0.4, band) * std.smoothstep(0.75, 0.05, ae);
    c = std.mix(c, TRUNK_FAR, trunkMask * 0.3);
    // the lake: pale blue and rose glints just below the horizon
    const lake = std.smoothstep(0.012, -0.004, el) * std.smoothstep(-0.07, -0.03, el);
    const glint = perlin2d.sample(d.vec2f(az * 22, el * 700)) * 0.5 + 0.5;
    const water = std.mix(LAKE, LAKE_ROSE, std.smoothstep(0.35, 0.75, glint)) + glint * 0.18;
    c = std.mix(c, std.mix(water, TRUNK_FAR, trunkMask * 0.4), lake * 0.75);
    return d.vec4f(c, 1);
  });
  const skyPipe = cfg.createRenderPipeline({
    vertex: skyVert, fragment: skyFrag, targets: { format: HDR },
    depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'always' },
    multisample: { count: 4 },
  });

  /* ---------- trunks, limbs, twigs ---------- */
  const trunkVert = tgpu.vertexFn({
    in: { at: d.vec2f, iid: d.builtin.instanceIndex },
    out: {
      position: d.builtin.position, wpos: d.vec3f, wnrm: d.vec3f, buv: d.vec2f, ang: d.f32,
      info: d.interpolate('flat', d.vec4f), kf: d.interpolate('flat', d.vec2u),
    },
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
    let lumps = 1 + 0.1 * std.sin(hs * 3.1 + T.seed * 20) + 0.07 * std.sin(a * 3 + hs * 1.7 + T.seed * 9) + 0.05 * std.sin(a * 7 - hs * 4.1);
    if (T.kind === TK.Hero) { lumps = lumps + 0.05 * std.sin(a * 9 + hs * 2.3) * std.sin(hs * 3.7 + a * 2); }
    // pollarded willows: a knobbly head swelling under the whips, closed on top
    const pollard = T.kind === TK.Pollard || T.kind === TK.PollardFace;
    const head = 1 + 0.55 * std.exp(-std.pow((t - 0.92) / 0.06, 2)) + 0.12 * std.sin(a * 5 + T.seed * 9) * std.smoothstep(0.82, 0.95, t);
    const cap = std.mix(0.25, 1, std.smoothstep(1.0, 0.965, t));
    const pk = std.select(d.f32(1), head * cap, pollard);
    const rr = T.r * (1 - t * (1 - T.taper)) * lumps * flare * pk;
    const radial = p1 * std.cos(a) + p2 * std.sin(a);
    const wp = c + radial * rr;
    // the bark angle facing the spawn point: faces look out from there
    const toS = std.normalize(d.vec2f(SPAWN[0] - T.base.x, SPAWN[2] - T.base.z));
    const front = std.atan2(std.dot(p2.xz, toS), std.dot(p1.xz, toS));
    return {
      position: frameAcc.$.viewProj * d.vec4f(wp, 1), wpos: wp, wnrm: radial,
      buv: d.vec2f(a * T.r, hs), ang: a, info: d.vec4f(T.seed, T.r, front, T.h), kf: d.vec2u(T.kind, T.fam),
    };
  });

  const wrapAngle = tgpu.fn([d.f32], d.f32)((x) => {
    'use gpu';
    return x - 6.2832 * std.round(x / 6.2832);
  });

  const barkFrag = tgpu.fragmentFn({
    in: {
      position: d.builtin.position, wpos: d.vec3f, wnrm: d.vec3f, buv: d.vec2f, ang: d.f32,
      info: d.interpolate('flat', d.vec4f), kf: d.interpolate('flat', d.vec2u), front: d.builtin.frontFacing,
    },
    out: d.vec4f,
  })((i) => {
    'use gpu';
    const aa = std.fwidth(i.buv.y) * 1.2;     // metres per pixel (uniform control flow)
    const kind = i.kf.x;
    const seed = i.info.x;
    const rad = i.info.y;
    const V = std.normalize(frameAcc.$.camPos - i.wpos);
    const G = std.normalize(i.wnrm);
    // the baked impasto, at this trunk's own place in the tile (sampled in uniform control flow)
    const bw = std.textureSample(barkTex.$, sRepeat.$, (i.buv + d.vec2f(seed * 7.31, seed * 13.7)) / BARK_TILE);
    let col = d.vec3f(0);
    let relief = d.f32(0);
    if (kind === TK.Twig) {
      col = twigColor(i.buv, seed);
    } else {
      col = barkFromWeights(bw, i.kf.y);
      relief = (bw.x + bw.y) * 0.8;
      // the visitor's direction in the bark's (around, up) frame: painted eyes follow it
      const tg = std.normalize(std.cross(d.vec3f(0, 1, 0), G) + d.vec3f(0.0001, 0, 0));
      const look = d.vec2f(std.dot(V, tg), V.y);
      const da = wrapAngle(i.ang - i.info.z);
      if (kind === TK.Hero) {
        col = faceCrowd(i.buv, 6.2832 * rad, look, forestU.$.time, aa, col);
        const mq = d.vec2f(da * rad, i.buv.y - HERO.mask);
        if (std.abs(mq.x) < 0.25 && std.abs(mq.y) < 0.3) { col = forkMask(mq, look, aa, col); }
      } else if (kind === TK.PollardFace) {
        const wq = d.vec2f(da * rad * 1.5, i.buv.y - i.info.w * 0.89);
        const open = std.select(d.f32(1), d.f32(0.06), std.fract(forestU.$.time * 0.13) < 0.02);
        if (std.abs(wq.x) < 0.45 && std.abs(wq.y) < 0.5) { col = willowFace(wq, look, open, aa, col); }
      }
    }
    let N = d.vec3f(G);
    if (!i.front) { N = N * -1; }
    // painted relief: every stroke is a little ridge of paint
    N = std.normalize(N + d.vec3f(0, (relief - 0.4) * 0.35, 0));
    return d.vec4f(finish(forestShade(col, N, V), i.wpos), 1);
  });
  const trunkPipe = cfg.createRenderPipeline({
    attribs: { at: atLayout.attrib }, vertex: trunkVert, fragment: barkFrag, targets: { format: HDR },
    primitive: { cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: 4 },
  });

  /* ---------- ground: a pointillist field of short strokes ---------- */
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
    // the lavender patch on the right, dry grass on the left (as in the painting)
    const lav = std.smoothstep(3.2, 1.2, std.length(p - d.vec2f(FC[0] + 5.6, FC[2] - 6.2)));
    const dry = std.smoothstep(-3.0, -5.0, p.x - FC[0]) * std.smoothstep(-10.0, -6.0, p.y - FC[2]);
    const g = p / 0.06;
    const cell = std.floor(g);
    let col = std.mix(groundPal.$[0], groundPal.$[6], perlin2d.sample(p * 0.7) * 0.5 + 0.5);
    let best = d.f32(-1);
    for (const oy of tgpu.unroll([-1, 0, 1])) {
      for (const ox of tgpu.unroll([-1, 0, 1])) {
        const c = cell + d.vec2f(ox, oy);
        randf.seed2(c);
        const ctr = c + d.vec2f(randf.sample(), randf.sample());
        const ang = 1.5708 + (randf.sample() - 0.5) * 1.3;   // mostly along the view (vertical on screen)
        const prio = randf.sample();
        const pick = randf.sample();
        const lp = g - ctr;
        const ca = std.cos(ang);
        const sa = std.sin(ang);
        const rp = d.vec2f(lp.x * ca + lp.y * sa, -lp.x * sa + lp.y * ca);
        const dist = std.length(rp / d.vec2f(1.0, 0.36));
        if (dist < 1 && prio > best) {
          best = prio;
          let k = d.u32(std.select(d.f32(0), d.f32(1), pick > 0.5));
          if (z1 > 0.24) { k = d.u32(std.select(d.f32(2), d.f32(3), pick > 0.62)); }
          else if (z2 > 0.3) { k = d.u32(std.select(d.f32(4), d.f32(6), pick > 0.5)); }
          if (pick > 0.985) { k = 7; }
          else if (pick > 0.94) { k = 5; }
          if (pick < lav * 0.8) { k = d.u32(std.select(d.f32(7), d.f32(2), pick > lav * 0.55)); }
          col = groundPal.$[k] * (0.88 + prio * 0.2);
          if (pick < dry * 0.7) { col = std.mix(col, d.vec3f(0.6, 0.38, 0.16), 0.55); }
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

  /* ---------- the three ladies ---------- */
  const veilVert = tgpu.vertexFn({
    in: { at: d.vec2f, iid: d.builtin.instanceIndex },
    out: { position: d.builtin.position, wpos: d.vec3f, wnrm: d.vec3f, ly: d.f32, ang: d.f32, lady: d.interpolate('flat', d.u32) },
  })((i) => {
    'use gpu';
    const L = ladies.$[i.iid];
    const a = i.at.x;
    const t = i.at.y;
    const s = L.s;
    const y = t * LADY_H * s;
    const e = 0.01 * s;
    const dr = (ladyRadius(y + e, s) - ladyRadius(y - e, s)) / (2 * e);
    // soft folds in the cloak, swaying a little
    const folds = 1 + 0.035 * std.sin(a * 7 + t * 9 + L.sway * 2) * std.smoothstep(0.84, 0.4, t);
    const rr = ladyRadius(y, s) * folds;
    const sway = L.sway * t * t * 0.1 * s;
    const wp = L.pos + d.vec3f(std.cos(a) * rr + sway, y, std.sin(a) * rr);
    const n = std.normalize(d.vec3f(std.cos(a), -dr, std.sin(a)));
    return { position: frameAcc.$.viewProj * d.vec4f(wp, 1), wpos: wp, wnrm: n, ly: y, ang: a, lady: i.iid };
  });
  const veilFrag = tgpu.fragmentFn({
    in: { wpos: d.vec3f, wnrm: d.vec3f, ly: d.f32, ang: d.f32, lady: d.interpolate('flat', d.u32) },
    out: d.vec4f,
  })((i) => {
    'use gpu';
    const aa = std.fwidth(i.ly) * 1.1;
    const L = ladies.$[i.lady];
    // angle around her, measured from the direction her face turns to
    const faceA = std.atan2(std.cos(L.yaw), std.sin(L.yaw));
    const da = wrapAngle(i.ang - faceA);
    const col = ladyColor(da, i.ly, L.s, L.pal, L.pupil, L.blink, aa);
    const N = std.normalize(i.wnrm);
    const V = std.normalize(frameAcc.$.camPos - i.wpos);
    // an airy glow along her silhouette, lit from behind
    const glow = std.pow(1 - std.abs(std.dot(N, V)), 3) * 0.25;
    return d.vec4f(finish(forestShade(col, N, V) + d.vec3f(1.0, 0.9, 0.7) * glow, i.wpos), 1);
  });
  const veilPipe = cfg.createRenderPipeline({
    attribs: { at: atLayout.attrib }, vertex: veilVert, fragment: veilFrag, targets: { format: HDR },
    primitive: { cullMode: 'back', frontFace: 'ccw' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    multisample: { count: 4 },
  });

  /* ---------- vegetation: brush dabs scattered once by a compute shader ---------- */
  const scatter = root.createGuardedComputePipeline((x) => {
    'use gpu';
    randf.seed2(d.vec2f(d.f32(x), 17.3));
    const sel = randf.sample();
    let pos = d.vec3f(0);
    let size = d.f32(0.1);
    let col = d.vec3f(1);
    let kind = d.f32(0);
    if (sel < 0.05) {
      // the ladies' hems, dissolving into the meadow in their own colours
      const j = d.u32(std.floor(randf.sample() * 2.999));
      const L = ladyAt.$[j];
      const ang = randf.sample() * 6.2832;
      const rr = (0.38 + std.sqrt(randf.sample()) * 0.75) * L.w;
      pos = d.vec3f(L.x + std.cos(ang) * rr, randf.sample() * 0.32 * L.w * (1.2 - rr / L.w), L.z + std.sin(ang) * rr);
      size = 0.035 + randf.sample() * 0.05;
      col = d.vec3f(cloakPal.$[j * 6 + d.u32(std.floor(randf.sample() * 5.99))]);
      kind = 2;
    } else if (sel < 0.4) {
      const b = bushes.$[d.u32(std.floor(randf.sample() * NB)) % NB];
      const s = b.z;
      const ang = randf.sample() * 6.2832;
      const rr = std.sqrt(randf.sample()) * 0.62 * s;
      const hy = (1 - (rr / (0.62 * s)) * (rr / (0.62 * s))) * 0.85 * s * randf.sample() + 0.05;
      pos = d.vec3f(b.x + std.cos(ang) * rr, hy, b.y + std.sin(ang) * rr);
      size = (0.018 + randf.sample() * 0.03) * (0.7 + s * 0.3);
      col = d.vec3f(bushPal.$[d.u32(b.w) * 6 + d.u32(std.floor(randf.sample() * 5.99))]);
      // dry tufts and heather are spiky strokes, the rest round dabs
      const spiky = (b.w > 3.5 && randf.sample() < 0.6) || (b.w < 0.5 && randf.sample() < 0.45);
      kind = std.select(d.f32(2), d.f32(0), spiky);
    } else {
      const ang = randf.sample() * 6.2832;
      const rr = std.sqrt(randf.sample()) * (BOUNDS - 1);
      pos = d.vec3f(FC[0] + std.cos(ang) * rr, 0, FC[2] + std.sin(ang) * rr);
      const tall = randf.sample();
      size = 0.024 + tall * tall * 0.07;
      const zone = perlin2d.sample(pos.xz * 0.12);
      const pick = randf.sample();
      let k = d.u32(std.select(d.f32(0), d.f32(1), pick > 0.5));
      if (pick > 0.8) { k = 6; }
      if (zone > 0.24) { k = d.u32(std.select(d.f32(2), d.f32(3), pick > 0.65)); }
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
    const c = d.arrayOf(d.vec2f, 4)([d.vec2f(-1, 0), d.vec2f(1, 0), d.vec2f(1, 1), d.vec2f(-1, 1)]);
    const D = dabsR.$[i.iid];
    const q = c[i.vid];
    const F = forestU.$;
    // grass strokes stand up (cylindrical billboard), flower/bush dabs face the camera
    const toCam = frameAcc.$.camPos - D.pos;
    const right = std.normalize(d.vec3f(toCam.z, 0, -toCam.x));
    const tall = D.kind < 0.5;
    const hgt = std.select(D.size * 1.1, D.size * 2.8, tall);
    const wid = std.select(D.size * 1.2, D.size * 0.22, tall);
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
    partW.$[x] = Particle({ pos, kind, vel: d.vec3f(randf.sample() * 5 + 4, randf.sample() * 3 + 3, (randf.sample() * 0.12 + 0.1) * std.sign(randf.sample() - 0.5)), phase: randf.sample() * 6.28 });
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
      // birds fluttering between the trunks (analytic orbit with a wavering path: vel = radius, height, speed)
      const a = F.time * p.vel.z + p.phase;
      const wv = std.sin(F.time * 0.7 + p.phase * 3);
      pos = d.vec3f(FC[0] + std.cos(a) * (p.vel.x + wv), p.vel.y + std.sin(F.time * 1.3 + p.phase) * 0.6, FC[2] - 2 + std.sin(a) * (p.vel.x + wv) * 0.75);
    }
    partW.$[x] = Particle({ pos, kind: p.kind, vel: p.vel, phase: p.phase });
  });

  const partVert = tgpu.vertexFn({
    in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
    out: { position: d.builtin.position, quv: d.vec2f, kind: d.interpolate('flat', d.f32), wpos: d.vec3f, tint: d.f32 },
  })((i) => {
    'use gpu';
    const c = d.arrayOf(d.vec2f, 4)([d.vec2f(-1, -1), d.vec2f(1, -1), d.vec2f(1, 1), d.vec2f(-1, 1)]);
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
      // a small bird with broad wings beating in its flight direction
      const a = F.time * P.vel.z + P.phase;
      const dir = std.normalize(d.vec3f(-std.sin(a), 0, std.cos(a) * 0.75) * std.sign(P.vel.z) + d.vec3f(0.0001, 0, 0));
      const side = std.normalize(std.cross(dir, d.vec3f(0, 1, 0)));
      const flap = std.sin(F.time * 11 + P.phase * 5);
      wp = wp + side * (q.x * 0.2) + dir * (q.y * 0.09) + d.vec3f(0, std.abs(q.x) * flap * 0.12, 0);
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
      // wings tapering to the tips + a small body, in the painting's orange, blue and violet
      const ax = std.abs(q.x);
      const wing = std.smoothstep(0.08, 0.0, std.abs(q.y + ax * 0.25) - (1 - ax) * 0.55) * std.smoothstep(1.0, 0.86, ax);
      const body = std.smoothstep(0.1, 0.0, std.length(q / d.vec2f(0.16, 0.9)) - 0.9);
      alpha = std.max(wing, body);
      col = birdPal.$[d.u32(std.floor(i.tint * 3.999))] * (0.85 + 0.3 * ax);
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

  const pipes = [skyPipe, trunkPipe, groundPipe, veilPipe, dabPipe, partPipe];
  const dbg = { sky: true, ground: true, trunks: true, twigs: true, ladies: true, dabs: true, particles: true };

  return {
    forestU, ladies,
    async warmup() { await Promise.all(pipes.map(p => p.initAsync())); },
    simulate() { stepParticles.dispatchThreads(NP); },
    dbg,
    draw(pass: PassLike) {
      if (dbg.sky) skyPipe.with(pass).draw(3);
      if (dbg.ground) groundPipe.with(pass).draw(6);
      if (dbg.trunks) trunkPipe.with(atLayout, cyl.buf).withIndexBuffer(cyl.idx).with(pass).drawIndexed(cyl.count, NT);
      if (dbg.twigs && NTW) trunkPipe.with(atLayout, twig.buf).withIndexBuffer(twig.idx).with(pass).drawIndexed(twig.count, NTW, 0, 0, NT);
      if (dbg.ladies) veilPipe.with(atLayout, ladyMesh.buf).withIndexBuffer(ladyMesh.idx).with(pass).drawIndexed(ladyMesh.count, LADIES.length);
      if (dbg.dabs) dabPipe.withIndexBuffer(quadIdx).with(pass).drawIndexed(6, NDAB);
      if (dbg.particles) partPipe.withIndexBuffer(quadIdx).with(pass).drawIndexed(6, NP);
    },
    counts: { trunks: NT, twigs: NTW, dabs: NDAB, particles: NP },
  };
}
export type ForestRender = ReturnType<typeof createForestRender>;
