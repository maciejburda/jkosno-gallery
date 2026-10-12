/* Painted bark of painting № 052: thick impasto strokes swirling around spiral knots, in the painting's
   olive / moss / rose / lavender / ochre families with dark green-blue contour strokes — and the faces:
   the crowd of grotesque faces covering the great tree, the pale toothy mask in its fork and the
   pollarded willow that watches you. Everything is evaluated per pixel (no textures). */
import { tgpu, d, std, type TgpuRoot } from 'typegpu';
import { perlin2d, randf } from '@typegpu/noise';

const lin = (h: string) => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255].map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) as [number, number, number];
};
export const vec = (h: string) => d.vec3f(...lin(h));

/* palette families: base, light, highlight, contour, accent */
const FAMILIES = [
  ['#8c8a4c', '#aaa86a', '#e6dcae', '#2e4232', '#d49c94'],   // 0 olive / moss
  ['#b48a86', '#cfa6a0', '#f0dcc8', '#4a3448', '#9aa060'],   // 1 rose / mauve
  ['#8a5a30', '#b07a3e', '#d8b064', '#3a2416', '#a8442c'],   // 2 ochre / umber (the great tree)
  ['#9a92b0', '#b8aec8', '#ece0d8', '#3a3858', '#a6a466'],   // 3 lavender
  ['#cec28a', '#e2d8a8', '#f6eed0', '#5c5a34', '#e0a888'],   // 4 sunlit cream
  ['#8a5040', '#a87a50', '#c8a868', '#3a2a20', '#a0a050'],   // 5 twigs, willow whips
];
const famPal = tgpu.const(d.arrayOf(d.vec3f, FAMILIES.length * 5), FAMILIES.flat().map(vec));

const OUTLINE = vec('#3a2214');
const LIPS = vec('#a8382a');
const MOUTH = vec('#2a0c08');
const TEETH = vec('#e8dcbc');
const EYE_WHITE = vec('#e6dcc0');
const IRIS = vec('#2e2a18');
const SKINS = tgpu.const(d.arrayOf(d.vec3f, 4), ['#a8703c', '#b0644e', '#8e7c3e', '#c49462'].map(vec));
const MASK_SKIN = vec('#d6c29a');

export const sdEllipse = tgpu.fn([d.vec2f, d.vec2f], d.f32)((p, r) => {
  'use gpu';
  return (std.length(p / r) - 1) * std.min(r.x, r.y);
});
export const sdSeg = tgpu.fn([d.vec2f, d.vec2f, d.vec2f], d.f32)((p, a, b) => {
  'use gpu';
  const pa = p - a;
  const ba = b - a;
  const h = std.clamp(std.dot(pa, ba) / std.dot(ba, ba), 0, 1);
  return std.length(pa - ba * h);
});
/* antialiased fill of a signed distance / a line of half-width w along its zero set */
export const fillF = tgpu.fn([d.f32, d.f32], d.f32)((dist, aa) => {
  'use gpu';
  return std.smoothstep(aa, -aa, dist);
});
export const lineF = tgpu.fn([d.f32, d.f32, d.f32], d.f32)((dist, w, aa) => {
  'use gpu';
  return std.smoothstep(w + aa, w - aa, std.abs(dist));
});

/* brush strokes on a jittered grid: the top-priority stroke covering p (3×3 neighbourhood).
   Each stroke is a capsule len × wid (metres) along dir, turned by up to ±jit/2 radians;
   dens = the chance a cell holds a stroke. */
export const Stroke = d.struct({ hit: d.f32, edge: d.f32, r1: d.f32, r2: d.f32 });
export const strokes = tgpu.fn([d.vec2f, d.f32, d.f32, d.f32, d.vec2f, d.f32, d.f32, d.f32], Stroke)((p, cell, len, wid, dir, jit, dens, seed) => {
  'use gpu';
  const c0 = std.floor(p / cell);
  let best = d.f32(-1);
  let edge = d.f32(0);
  let r1 = d.f32(0);
  let r2 = d.f32(0);
  for (const oy of tgpu.unroll([-1, 0, 1])) {
    for (const ox of tgpu.unroll([-1, 0, 1])) {
      const c = c0 + d.vec2f(ox, oy);
      randf.seed3(d.vec3f(c, seed));
      const ctr = (c + d.vec2f(randf.sample(), randf.sample())) * cell;
      const prio = randf.sample();
      const sz = 0.7 + randf.sample() * 0.6;
      const ja = (randf.sample() - 0.5) * jit;
      const live = randf.sample() < dens;
      const ca = std.cos(ja);
      const sa = std.sin(ja);
      const dv = d.vec2f(dir.x * ca - dir.y * sa, dir.x * sa + dir.y * ca);
      const q = p - ctr;
      const along = std.max(std.abs(std.dot(q, dv)) - len * 0.5 * sz, 0);
      const across = std.dot(q, d.vec2f(-dv.y, dv.x));
      const dist = std.length(d.vec2f(along, across)) / (wid * 0.5 * sz);
      if (live && dist < 1 && prio > best) {
        best = prio;
        edge = 1 - dist;
        r1 = randf.sample();
        r2 = randf.sample();
      }
    }
  }
  return Stroke({ hit: std.select(d.f32(0), d.f32(1), best >= 0), edge, r1, r2 });
});

/* ---------- the bark, baked once ----------
   The impasto pattern is expensive (a swirl field steering brush strokes, spiral contours around every
   knot), and trunks cover half the screen — so it is painted once by a compute shader into a seamless
   16 × 16 m tile (128 px/m on desktop) holding four palette weights (light, highlight, accent, contour;
   the rest is the base colour). Each trunk samples it at its own offset and recolours it with its
   family; mipmaps take care of the distance. */
export const BARK_TILE = 16;
const VX = 29, VY = 20;      // vortex cells per tile (0.55 × 0.8 m)
const SC = 470;              // stroke cells per tile (3.4 cm)

const seedWrapped = tgpu.fn([d.vec2f, d.vec2f, d.f32])((c, n, salt) => {
  'use gpu';
  randf.seed3(d.vec3f(c - n * std.floor(c / n), salt));
});

const barkWeights = tgpu.fn([d.vec2f], d.vec4f)((uv) => {
  'use gpu';
  const m = uv * BARK_TILE;
  // the swirl field: nearest of the jittered vortices (one per cell, hashed periodically)
  const nv = d.vec2f(VX, VY);
  const cs = d.vec2f(BARK_TILE / VX, BARK_TILE / VY);
  const b0 = std.floor(m / cs - 0.5);
  let best = d.f32(1e9);
  let vc = d.vec2f(0);
  let vr = d.f32(0.2);
  let spin = d.f32(1);
  for (const oy of tgpu.unroll([0, 1])) {
    for (const ox of tgpu.unroll([0, 1])) {
      const c = b0 + d.vec2f(ox, oy);
      seedWrapped(c, nv, 5);
      const p = (c + d.vec2f(0.2 + randf.sample() * 0.6, 0.2 + randf.sample() * 0.6)) * cs;
      const rr = 0.09 + randf.sample() * 0.2;
      const sp = std.select(d.f32(-1), d.f32(1), randf.sample() > 0.5);
      const dd = std.length(m - p) / rr;
      if (dd < best) { best = dd; vc = d.vec2f(p); vr = d.f32(rr); spin = d.f32(sp); }
    }
  }
  const rel = m - vc;
  const rl = std.max(std.length(rel), 0.0001);
  const w = std.exp(-best * best * 0.6);
  const wob = perlin2d.sample(uv * d.vec2f(24, 8));          // periodic over the tile
  const grain = std.normalize(d.vec2f(wob * 0.8, 1));
  const tang = d.vec2f(-rel.y, rel.x) * (spin / rl);
  const flow = std.normalize(std.mix(grain, tang, w) + d.vec2f(0.0001, 0));
  // short strokes following the flow (3×3 neighbourhood, periodic cells)
  const cell = d.f32(BARK_TILE / SC);
  const ns = d.vec2f(SC, SC);
  const c0 = std.floor(m / cell);
  let top = d.f32(-1);
  let edge = d.f32(0);
  let r1 = d.f32(0);
  let r2 = d.f32(0);
  for (const oy of tgpu.unroll([-1, 0, 1])) {
    for (const ox of tgpu.unroll([-1, 0, 1])) {
      const c = c0 + d.vec2f(ox, oy);
      seedWrapped(c, ns, 1);
      const q = m - (c + d.vec2f(randf.sample(), randf.sample())) * cell;
      const prio = randf.sample();
      const sz = 0.7 + randf.sample() * 0.6;
      const ja = (randf.sample() - 0.5) * 0.35;
      const ca = std.cos(ja);
      const sa = std.sin(ja);
      const dv = d.vec2f(flow.x * ca - flow.y * sa, flow.x * sa + flow.y * ca);
      const along = std.max(std.abs(std.dot(q, dv)) - 0.0375 * sz, 0);
      const dist = std.length(d.vec2f(along, std.dot(q, d.vec2f(-dv.y, dv.x)))) / (0.012 * sz);
      if (dist < 1 && prio > top) {
        top = prio;
        edge = 1 - dist;
        r1 = randf.sample();
        r2 = randf.sample();
      }
    }
  }
  // the stroke's colour as weights of the family: base / light / highlight / accent / a dark mix
  let wv = d.vec4f(0, 0, 0, 0.6);
  if (r1 < 0.36) { wv = d.vec4f(0); }
  else if (r1 < 0.64) { wv = d.vec4f(1, 0, 0, 0); }
  else if (r1 < 0.8) { wv = d.vec4f(0, 1, 0, 0); }
  else if (r1 < 0.93) { wv = d.vec4f(0, 0, 1, 0); }
  // brightness jitter: towards the contour colour or the highlight
  wv = wv * (1 - std.abs(r2 - 0.5) * 0.4) + std.select(d.vec4f(0, 0, 0, (0.5 - r2) * 0.4), d.vec4f(0, (r2 - 0.5) * 0.4, 0, 0), r2 > 0.5);
  // darker underpaint between the strokes
  const cov = std.select(d.f32(0), std.smoothstep(0.0, 0.3, edge), top >= 0);
  wv = std.mix(d.vec4f(0, 0, 0, 0.42), wv, cov);
  // spiral contour strokes winding around each knot, and its dark core
  const ph = std.fract(rl / (vr * 0.38) - std.atan2(rel.y, rel.x) * spin * 0.159);
  const spiral = std.smoothstep(0.13, 0.05, std.min(ph, 1 - ph)) * std.smoothstep(2.4, 1.1, best);
  wv = std.mix(wv, d.vec4f(0, 0, 0, 1), spiral * 0.75);
  wv = std.mix(wv, d.vec4f(0, 0, 0, 1), std.smoothstep(0.32, 0.12, best) * 0.8);
  return wv;
});

export function bakeBark(root: TgpuRoot, size: number) {
  const mipLevelCount = Math.floor(Math.log2(size)) + 1;
  const tex = root.createTexture({ size: [size, size], format: 'rgba8unorm', mipLevelCount }).$usage('storage', 'sampled', 'render');
  const texW = tex.createView(d.textureStorage2d('rgba8unorm', 'write-only'), { mipLevelCount: 1 });
  // periodic Perlin: a 24 × 8 lattice spans exactly one tile
  const cache = perlin2d.staticCache({ root, size: d.vec2u(24, 8) });
  const texel = 1 / size;
  const pipe = root.pipe(cache.inject()).createGuardedComputePipeline((x, y) => {
    'use gpu';
    const uv = (d.vec2f(d.f32(x), d.f32(y)) + 0.5) * texel;
    std.textureStore(texW.$, d.vec2u(x, y), barkWeights(uv));
  });
  pipe.dispatchThreads(size, size);
  tex.generateMipmaps();
  cache.destroy();
  return tex.createView(d.texture2d(d.f32));
}

/* bark colour from the baked weights, in a trunk's palette family */
export const barkFromWeights = tgpu.fn([d.vec4f, d.u32], d.vec3f)((w, fam) => {
  'use gpu';
  const k0 = fam * 5;
  const rest = std.max(1 - w.x - w.y - w.z - w.w, 0);
  return famPal.$[k0] * rest + famPal.$[k0 + 1] * w.x + famPal.$[k0 + 2] * w.y + famPal.$[k0 + 4] * w.z + famPal.$[k0 + 3] * w.w;
});

/* twigs and willow whips: a few quick strokes along their length (cheap — there are thousands) */
export const twigColor = tgpu.fn([d.vec2f, d.f32], d.vec3f)((uv, seed) => {
  'use gpu';
  randf.seed2(std.floor(uv * d.vec2f(30, 3.5)) + seed * 7);
  const k = d.u32(25) + d.u32(std.floor(randf.sample() * 4.99));
  return famPal.$[std.min(k, d.u32(29))] * (0.85 + randf.sample() * 0.3);
});

/* one painted face: q in metres (face ≈ 0.33 × 0.41 m), base = the bark behind, skinMix 0 → features only.
   eyeType < 0.5: dark hollows with a glint; otherwise whites with irises that follow the visitor (look).
   mouth: 0 open "O", 1 toothy grin, 2 closed, 3 none. Returns (colour, inside the head). */
export const paintFace = tgpu.fn([d.vec2f, d.vec3f, d.vec3f, d.f32, d.f32, d.f32, d.vec2f, d.f32, d.f32], d.vec4f)(
  (q, base, skin, skinMix, eyeType, mouth, look, open, aa) => {
    'use gpu';
    const head = sdEllipse(q, d.vec2f(0.165, 0.205));
    const inside = fillF(head, aa);
    const shade = std.mix(0.6, 1.0, std.smoothstep(0, 0.07, -head));
    let col = std.mix(base, skin * shade, skinMix * inside);
    const hollow = eyeType < 0.5;
    for (const sx of tgpu.unroll([-1, 1])) {
      const ec = d.vec2f(sx * 0.062, 0.035);
      // shadowed socket
      col = std.mix(col, col * 0.5, fillF(sdEllipse(q - ec, d.vec2f(0.055, 0.036)), aa * 3) * 0.55);
      const ep = (q - ec) / d.vec2f(1, std.max(open, 0.07));
      const almond = sdEllipse(ep, d.vec2f(0.037, 0.021));
      const white = fillF(almond, aa);
      const ic = ep - look * d.vec2f(0.017, 0.009);
      col = std.mix(col, std.select(EYE_WHITE, OUTLINE * 0.6, hollow), white);
      const iris = fillF(std.length(ic) - std.select(d.f32(0.015), d.f32(0.006), hollow), aa) * white;
      col = std.mix(col, std.select(IRIS, EYE_WHITE, hollow), iris);
      col = std.mix(col, OUTLINE, lineF(almond, 0.004, aa) * std.smoothstep(-0.01, 0.004, ep.y));
      // brow
      const bc = d.vec2f(sx * 0.058, -0.03);
      const brow = lineF(std.length(q - bc) - 0.1, 0.007, aa) * std.smoothstep(0.05, 0.03, std.abs(q.x - sx * 0.06)) * std.step(0.06, q.y);
      col = std.mix(col, OUTLINE, brow * 0.85);
      // cheek
      const cq = q - d.vec2f(sx * 0.095, -0.065);
      col = std.mix(col, LIPS * 1.4, std.exp(-std.dot(cq, cq) / 0.0018) * 0.35 * inside * skinMix);
    }
    // nose: a ridge stroke and two nostrils
    col = std.mix(col, OUTLINE, lineF(sdSeg(q, d.vec2f(0.004, 0.02), d.vec2f(0.014, -0.058)), 0.005, aa) * 0.7);
    col = std.mix(col, OUTLINE, fillF(std.length(std.abs(q - d.vec2f(0, -0.066)) - d.vec2f(0.017, 0)) - 0.008, aa) * 0.8);
    // mouth
    const mc = q - d.vec2f(0, -0.122);
    if (mouth < 0.5) {
      const e = sdEllipse(mc, d.vec2f(0.032, 0.04));
      col = std.mix(col, LIPS, fillF(e - 0.011, aa));
      col = std.mix(col, MOUTH, fillF(e, aa));
    } else if (mouth < 1.5) {
      const e = std.max(sdEllipse(mc, d.vec2f(0.082, 0.042)), mc.y - 0.008);
      col = std.mix(col, LIPS, fillF(e - 0.008, aa));
      const teeth = std.select(MOUTH, TEETH, std.abs(std.fract(mc.x / 0.019) - 0.5) < 0.36 && mc.y > -0.03);
      col = std.mix(col, teeth, fillF(e, aa));
    } else if (mouth < 2.5) {
      const smile = lineF(sdEllipse(mc - d.vec2f(0, 0.035), d.vec2f(0.06, 0.045)), 0.005, aa) * std.step(mc.y, -0.002);
      col = std.mix(col, LIPS * 0.7, smile);
    }
    // the head's painted outline
    const brk = std.smoothstep(-0.3, 0.4, std.sin(std.atan2(q.y, q.x) * 7 + q.x * 40));
    col = std.mix(col, OUTLINE, lineF(head, 0.007, aa) * std.min(skinMix * 1.4, 1) * brk);
    return d.vec4f(col, inside);
  });

/* the crowd of faces on the tree: one face per cell of a brick grid that wraps the trunk
   (circ = its circumference), from the roots up to the fork. look = the visitor's direction in the bark's
   (around, up) frame, so every face watches you; a few blink now and then. */
export const faceCrowd = tgpu.fn([d.vec2f, d.f32, d.vec2f, d.f32, d.f32, d.vec3f], d.vec3f)((uv, circ, look, time, aa, base) => {
  'use gpu';
  const n = std.max(std.round(circ / 0.25), 1);
  const cw = circ / n;
  const ch = d.f32(0.27);
  const row = std.floor(uv.y / ch);
  const x = uv.x + std.fract(row * 0.5) * cw;
  const cx = std.floor(x / cw);
  randf.seed2(d.vec2f(cx - n * std.floor(cx / n), row) * d.vec2f(1.7, 3.1) + 0.5);
  const jit = d.vec2f(randf.sample() - 0.5, randf.sample() - 0.5) * d.vec2f(0.07, 0.07);
  const sc = 0.42 + randf.sample() * 0.32;
  const tilt = (randf.sample() - 0.5) * 0.5;
  const skin = SKINS.$[d.u32(std.floor(randf.sample() * 3.99))];
  const eyeT = randf.sample();
  const mouth = std.floor(randf.sample() * 3.6);
  const blinkPh = randf.sample();
  const has = randf.sample() < 0.88 && uv.y > 0.22 && uv.y < 2.86;
  const lp = d.vec2f(x - (cx + 0.5) * cw, uv.y - (row + 0.5) * ch) - jit;
  const ct = std.cos(tilt);
  const st = std.sin(tilt);
  const q = d.vec2f(lp.x * ct - lp.y * st, lp.x * st + lp.y * ct) / sc;
  const open = std.select(d.f32(1), d.f32(0.05), std.fract(time * 0.09 + blinkPh) < 0.018);
  const f = paintFace(q, base, skin * (0.8 + randf.sample() * 0.3), 0.68 + randf.sample() * 0.27, eyeT - 0.35, mouth, look, open, aa / sc);
  return std.select(base, f.xyz, has);
});

/* the pale mask grinning from the fork of the great tree (q relative to its centre, metres) */
export const forkMask = tgpu.fn([d.vec2f, d.vec2f, d.f32, d.vec3f], d.vec3f)((q, look, aa, base) => {
  'use gpu';
  const s = d.f32(1.1);
  const f = paintFace(q / s, base, MASK_SKIN, 0.92, 0, 1, look, 1, aa / s);
  return f.xyz;
});

/* the pollarded willow's face: bark-coloured, only eyes, brows and the nose ridge are painted in */
export const willowFace = tgpu.fn([d.vec2f, d.vec2f, d.f32, d.f32, d.vec3f], d.vec3f)((q, look, open, aa, base) => {
  'use gpu';
  const s = d.f32(1.8);
  const f = paintFace(q / s, base, base * 1.12, 0.6, 1, 3, look, open, aa / s);
  return f.xyz;
});
