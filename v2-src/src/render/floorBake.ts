/* Floors are baked once on the GPU (compute) from the v1 recipes — chevron, planks, stone,
   terrazzo, basket weave and marble — into two tileable texture arrays (one layer per room):
     albedo: rgb (sRGB-encoded, decoded in the shader) + roughness       detail: normal.xy + cavity + reflectivity
   Periodic Perlin noise (@typegpu/noise static cache, 8×8 lattice) keeps every tile seamless;
   non-periodic macro variation is added later in the floor shader so the repeat never shows. */
import { tgpu, d, std, type TgpuRoot } from 'typegpu';
import { perlin2d, randf } from '@typegpu/noise';
import { hsl2rgb, linearToSrgb } from './gpuMath.ts';
import type { FloorRecipe } from '../world/styles.ts';

const FloorParams = d.struct({ kind: d.u32, rows: d.f32, gap: d.f32, polish: d.f32, hsl: d.vec3f, pad: d.f32 });
const Surf = d.struct({ col: d.vec3f, h: d.f32, rough: d.f32, refl: d.f32 });

const rnd = tgpu.fn([d.vec2f, d.f32], d.f32)((cell, salt) => {
  'use gpu';
  randf.seed3(d.vec3f(cell, salt));
  return randf.sample();
});

/* periodic fBm over the tile (lattice 8): frequencies must be multiples of 8 */
const fbm = tgpu.fn([d.vec2f, d.f32], d.f32)((uv, f) => {
  'use gpu';
  let s = perlin2d.sample(uv * f) * 0.55;
  s += perlin2d.sample(uv * (f * 2) + 1.7) * 0.28;
  s += perlin2d.sample(uv * (f * 4) + 3.1) * 0.17;
  return s;
});

const jitterHsl = tgpu.fn([d.vec2f, d.vec3f, d.f32], d.vec3f)((id, hsl, amt) => {
  'use gpu';
  const h = hsl.x + (rnd(id, 2) - 0.5) * 8 * amt;
  const s = hsl.y + (rnd(id, 3) - 0.5) * 10 * amt;
  const l = hsl.z + (rnd(id, 4) - 0.5) * 12 * amt;
  return hsl2rgb(h, std.clamp(s, 0, 100) / 100, std.clamp(l, 2, 98) / 100);
});

/* soft joint mask from a distance in tile units */
const joint = tgpu.fn([d.f32], d.f32)((dist) => {
  'use gpu';
  return 1 - std.smoothstep(0.0005, 0.0017, dist);
});

const wood = tgpu.fn([d.vec2f, d.vec2f, d.vec3f], d.vec3f)((along, id, hsl) => {
  'use gpu';
  const base = jitterHsl(id, hsl, d.f32(1));
  const streak = perlin2d.sample(d.vec2f(along.x * 8, along.y * 64) + rnd(id, d.f32(7)) * 8);
  const fine = perlin2d.sample(d.vec2f(along.x * 32, along.y * 256));
  const rings = std.sin((along.y * 90 + streak * 2.6 + rnd(id, 9) * 6.28)) * 0.5 + 0.5;
  const tone = 0.86 + streak * 0.16 + fine * 0.05 + rings * 0.06;
  return base * tone;
});

const planks = tgpu.fn([d.vec2f, d.f32, d.f32, d.vec3f], Surf)((uv, rows, gap, hsl) => {
  'use gpu';
  const rv = uv.y * rows;
  const row = std.floor(rv);
  const fy = std.fract(rv);
  const off = rnd(d.vec2f(row, 1), d.f32(1));
  const bu = uv.x * 2 + off;
  const board = std.floor(bu);
  const fx = std.fract(bu);
  const id = d.vec2f(std.floor(board - std.floor(board / 2) * 2), row);
  const col = wood(d.vec2f(uv.x, uv.y), id, hsl);
  const dEdge = std.min(std.min(fy, 1 - fy) / rows, std.min(fx, 1 - fx) / 2);
  const j = joint(dEdge);
  const grain = perlin2d.sample(d.vec2f(uv.x * 8, uv.y * rows * 8));
  return Surf({
    col: col * (1 - j * gap * 0.9),
    h: grain * 0.25 - j + std.smoothstep(0.0, 0.006, dEdge) * 0.15,
    rough: 0.4 + grain * 0.06 + j * 0.4,
    refl: 1 - j,
  });
});

const chevron = tgpu.fn([d.vec2f, d.f32, d.vec3f], Surf)((uv, gap, hsl) => {
  'use gpu';
  const lv = uv.y * 4;
  const lane = std.floor(lv);
  const fy = std.fract(lv);
  const s = std.select(d.f32(-1), d.f32(1), (lane - std.floor(lane / 2) * 2) < 0.5);
  const t = (uv.x * 4 + s * fy) * 3;
  const board = std.floor(t);
  const fb = std.fract(t);
  const id = d.vec2f(board - std.floor(board / 12) * 12, lane);
  const along = d.vec2f(fy * 0.25, fb / 12);
  const col = wood(along, id, hsl);
  const dEdge = std.min(std.min(fy, 1 - fy) / 4, std.min(fb, 1 - fb) / 12 * 0.7071);
  const j = joint(dEdge);
  const grain = perlin2d.sample(d.vec2f(uv.x * 16, uv.y * 16));
  return Surf({
    col: col * (1 - j * gap * 0.9),
    h: grain * 0.2 - j + std.smoothstep(0.0, 0.005, dEdge) * 0.15,
    rough: 0.36 + grain * 0.05 + j * 0.45,
    refl: 1 - j,
  });
});

const basket = tgpu.fn([d.vec2f, d.f32, d.vec3f], Surf)((uv, gap, hsl) => {
  'use gpu';
  const bu = uv * 4;
  const blk = std.floor(bu);
  const f = std.fract(bu);
  const chk = (blk.x + blk.y) - std.floor((blk.x + blk.y) / 2) * 2;
  const horiz = chk < 0.5;
  const across = std.select(f.x, f.y, horiz);
  const slat = std.floor(across * 3);
  const fs = std.fract(across * 3);
  const id = d.vec2f(blk.x * 7 + blk.y * 3 + slat, slat + blk.y);
  const along = std.select(d.vec2f(f.y * 0.25, f.x * 0.25), d.vec2f(f.x * 0.25, f.y * 0.25), horiz);
  const col = wood(along, id, hsl);
  const dBlk = std.min(std.min(f.x, 1 - f.x), std.min(f.y, 1 - f.y)) / 4;
  const dEdge = std.min(dBlk, std.min(fs, 1 - fs) / 12);
  const j = joint(dEdge);
  const grain = perlin2d.sample(uv * 16);
  return Surf({
    col: col * (1 - j * gap * 0.9),
    h: grain * 0.2 - j + std.smoothstep(0.0, 0.004, dEdge) * 0.12,
    rough: 0.42 + grain * 0.05 + j * 0.4,
    refl: 1 - j,
  });
});

const stone = tgpu.fn([d.vec2f, d.f32, d.vec3f], Surf)((uv, gap, hsl) => {
  'use gpu';
  const rv = uv.y * 3;
  const row = std.floor(rv);
  const fy = std.fract(rv);
  const split = 0.3 + rnd(d.vec2f(row, 5), d.f32(1)) * 0.4;
  const offset = rnd(d.vec2f(row, 6), d.f32(2));
  const xu = std.fract(uv.x + offset);
  const second = xu > split;
  const dx = std.select(std.min(xu, split - xu), std.min(xu - split, 1 - xu), second);
  const id = d.vec2f(row, std.select(d.f32(0), d.f32(1), second));
  const base = jitterHsl(id, hsl, 0.6);
  const mott = fbm(uv, d.f32(8));
  const speck = std.smoothstep(0.55, 0.75, perlin2d.sample(uv * 128));
  const col = base * (0.9 + mott * 0.18) * (1 - speck * 0.18);
  const dEdge = std.min(std.min(fy, 1 - fy) / 3, dx);
  const j = joint(dEdge * 0.5);
  return Surf({
    col: col * (1 - j * 0.55),
    h: mott * 0.35 - j * 1.2 + perlin2d.sample(uv * 64) * 0.12,
    rough: 0.62 + mott * 0.1 + j * 0.3,
    refl: (1 - j) * 0.8,
  });
});

const terrazzo = tgpu.fn([d.vec2f], Surf)((uv) => {
  'use gpu';
  const G = d.f32(24);
  const cell = std.floor(uv * G);
  let col = hsl2rgb(40, 0.2, 0.8) * (0.96 + perlin2d.sample(uv * 64) * 0.05);
  let h = d.f32(0);
  for (const oy of tgpu.unroll([-1, 0, 1])) {
    for (const ox of tgpu.unroll([-1, 0, 1])) {
      const c = cell + d.vec2f(ox, oy);
      const cw = c - std.floor(c / G) * G;
      const ctr = (c + d.vec2f(rnd(cw, 11), rnd(cw, 12))) / G;
      const rad = (0.14 + rnd(cw, 13) * 0.34) / G;
      const dlt = uv - ctr;
      const wob = perlin2d.sample(dlt * G * 8 + cw) * 0.25;
      const dist = std.length(dlt) / rad + wob;
      if (dist < 1 && rnd(cw, 14) < 0.82) {
        const pick = rnd(cw, 15);
        let chip = d.vec3f(0.24, 0.23, 0.22);
        if (pick < 0.22) { chip = d.vec3f(0.62, 0.29, 0.22); }
        else if (pick < 0.42) { chip = d.vec3f(0.86, 0.84, 0.8); }
        else if (pick < 0.58) { chip = d.vec3f(0.72, 0.54, 0.25); }
        else if (pick < 0.72) { chip = d.vec3f(0.44, 0.48, 0.43); }
        else if (pick < 0.86) { chip = d.vec3f(0.78, 0.44, 0.31); }
        col = chip * (0.9 + rnd(cw, 16) * 0.2);
        h = 0.05;
      }
    }
  }
  return Surf({ col, h, rough: 0.2, refl: d.f32(1) });
});

const marble = tgpu.fn([d.vec2f], Surf)((uv) => {
  'use gpu';
  const tu = uv * 2;
  const t = std.floor(tu);
  const f = std.fract(tu);
  const odd = (t.x + t.y) - std.floor((t.x + t.y) / 2) * 2 > 0.5;
  const w = fbm(uv, d.f32(8)) * 1.6 + fbm(uv + 0.37, d.f32(16)) * 0.5;
  const coord = std.select(uv.x + uv.y, uv.x - uv.y + 1, odd);
  const v = std.abs(std.sin((coord * 2 + w * 0.45) * Math.PI * 2));
  const veins = std.pow(1 - v, 10) * 0.8 + std.pow(1 - v, 40) * 0.5;
  const base = std.select(d.vec3f(0.93, 0.91, 0.87), d.vec3f(0.84, 0.8, 0.74), odd);
  const col = base * (0.97 + fbm(uv, d.f32(32)) * 0.05) - d.vec3f(0.36, 0.37, 0.4) * veins;
  const dEdge = std.min(std.min(f.x, 1 - f.x), std.min(f.y, 1 - f.y)) / 2;
  const j = joint(dEdge);
  return Surf({
    col: col * (1 - j * 0.35),
    h: -j + veins * 0.02,
    rough: 0.1 + veins * 0.05 + j * 0.5,
    refl: 1 - j * 0.8,
  });
});

export function bakeFloors(root: TgpuRoot, recipes: FloorRecipe[], size: number) {
  const L = recipes.length;
  const mipLevelCount = Math.floor(Math.log2(size)) + 1;
  const albedo = root.createTexture({ size: [size, size, L], format: 'rgba8unorm', mipLevelCount })
    .$usage('storage', 'sampled', 'render');
  const detail = root.createTexture({ size: [size, size, L], format: 'rgba8unorm', mipLevelCount })
    .$usage('storage', 'sampled', 'render');
  const albedoW = albedo.createView(d.textureStorage2dArray('rgba8unorm', 'write-only'), { mipLevelCount: 1 });
  const detailW = detail.createView(d.textureStorage2dArray('rgba8unorm', 'write-only'), { mipLevelCount: 1 });

  const params = root.createReadonly(d.arrayOf(FloorParams, L), recipes.map(r => ({
    kind: r.kind, rows: r.rows, gap: r.gap, polish: r.polish, hsl: d.vec3f(r.hue, r.sat, r.light), pad: 0,
  })));

  const surf = (uv: d.v2f, layer: number) => {
    'use gpu';
    const p = params.$[layer];
    if (p.kind === 0) { return marble(uv); }
    if (p.kind === 1) { return chevron(uv, p.gap, p.hsl); }
    if (p.kind === 2) { return planks(uv, p.rows, p.gap, p.hsl); }
    if (p.kind === 3) { return stone(uv, p.gap, p.hsl); }
    if (p.kind === 4) { return terrazzo(uv); }
    return basket(uv, p.gap, p.hsl);
  };

  const texel = 1 / size;
  const cache = perlin2d.staticCache({ root, size: d.vec2u(8, 8) });
  const pipe = root.pipe(cache.inject()).createGuardedComputePipeline((x, y, z) => {
    'use gpu';
    const uv = (d.vec2f(d.f32(x), d.f32(y)) + 0.5) * texel;
    const s0 = surf(uv, z);
    const sx = surf(uv + d.vec2f(texel, 0), z);
    const sy = surf(uv + d.vec2f(0, texel), z);
    const k = 2.2;
    const n = std.normalize(d.vec3f((s0.h - sx.h) * k, (s0.h - sy.h) * k, 1));
    const cavity = std.clamp(1 + std.min(s0.h, 0) * 0.55, 0, 1);
    std.textureStore(albedoW.$, d.vec2u(x, y), z, d.vec4f(linearToSrgb(std.clamp(s0.col, d.vec3f(0), d.vec3f(1))), s0.rough));
    std.textureStore(detailW.$, d.vec2u(x, y), z, d.vec4f(n.xy * 0.5 + 0.5, cavity, s0.refl));
  });
  pipe.dispatchThreads(size, size, L);
  albedo.generateMipmaps();
  detail.generateMipmaps();
  cache.destroy();

  return {
    albedo: albedo.createView(d.texture2dArray(d.f32)),   // sRGB-encoded: decode after sampling
    detail: detail.createView(d.texture2dArray(d.f32)),
  };
}
