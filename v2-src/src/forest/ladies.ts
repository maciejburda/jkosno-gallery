/* The three ladies of painting № 052: tall slender bell-shaped figures, a small pale face with teal almond
   eyes (they follow the visitor and blink), long copper hair falling from the head, and a cloak of loose
   colourful dabs on a light ground that dissolves into the meadow at the hem.
   Shape: a body of revolution (cone + bell flare + neck + head), radius given by ladyRadius(); the face,
   hair and mosaic are painted per pixel in the lady's own (angle around her, height) frame. */
import { tgpu, d, std } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { vec, sdEllipse, sdSeg, fillF, lineF, strokes } from './bark.ts';

export const LADY_H = 1.9;   // height per unit of scale

/* palettes read off the painting: the blue lady (left), the amber lady (right), the hidden pink one */
const CLOAKS = [
  ['#5b8fd6', '#f2d04a', '#ee8a3a', '#f0a0b0', '#f6f0dc', '#d24a32'],
  ['#ee7a32', '#d8402a', '#3aa8a0', '#f2c84a', '#f0a0a8', '#f4e6c8'],
  ['#e88aa8', '#f2b8c8', '#e8b04a', '#b898d0', '#f4e2c8', '#d06a8a'],
];
export const cloakPal = tgpu.const(d.arrayOf(d.vec3f, 18), CLOAKS.flat().map(vec));
const hairDark = tgpu.const(d.arrayOf(d.vec3f, 3), ['#a8361a', '#a84a1e', '#b8602e'].map(vec));
const hairLight = tgpu.const(d.arrayOf(d.vec3f, 3), ['#f08a4a', '#f29a48', '#f4b070'].map(vec));
/* where the cape of hair over the shoulders ends, and how far the strands down the back fall
   (fractions of the height): the blue lady's reach the ground */
const capeEnd = tgpu.const(d.arrayOf(d.f32, 3), [0.6, 0.58, 0.64]);
const hairEnd = tgpu.const(d.arrayOf(d.f32, 3), [0.02, 0.4, 0.5]);
const GROUND = vec('#f4e6bc');
const MEADOW = vec('#eeb85a');
const SKIN = vec('#f6dcc2');
const BLUSH = vec('#f0a49c');
const SCLERA = vec('#f6efe2');
const IRIS = vec('#3e9a8e');
const PUPIL = vec('#16282a');
const LID = vec('#8a4a2e');
const LIPS = vec('#cc6462');

/* radius of the figure at height y (metres) for scale s: a cone with a bell flare, a narrow neck,
   a small head on top, joined with a smooth max */
export const ladyRadius = tgpu.fn([d.f32, d.f32], d.f32)((y, s) => {
  'use gpu';
  const H = LADY_H * s;
  const t = y / H;
  const k = std.clamp(t / 0.86, 0, 1);
  let body = std.mix(0.36 * s, 0.1 * s, std.pow(k, 1.25)) + 0.05 * s * std.smoothstep(0.14, 0.0, t);
  body = body * std.smoothstep(0.9, 0.86, t);
  const hy = (y - (H - 0.12 * s)) / (0.12 * s);
  const head = 0.1 * s * std.sqrt(std.max(1 - hy * hy, 0));
  const kk = 0.03 * s;
  const h = std.clamp(0.5 + 0.5 * (head - body) / kk, 0, 1);
  return std.mix(body, head, h) + kk * h * (1 - h);
});

/* the face, in face units (metres at s = 1, origin between the eyes' line and the nose) */
const ladyFace = tgpu.fn([d.vec2f, d.vec2f, d.f32, d.f32], d.vec3f)((p, pupil, open, aa) => {
  'use gpu';
  const e = sdEllipse(p, d.vec2f(0.052, 0.08));
  let col = SKIN * std.mix(0.84, 1.0, std.smoothstep(0, 0.03, -e));
  for (const sx of tgpu.unroll([-1, 1])) {
    const cq = p - d.vec2f(sx * 0.034, -0.03);
    col = std.mix(col, BLUSH, std.exp(-std.dot(cq, cq) / 0.00035) * 0.4);
    const ec = d.vec2f(sx * 0.025, 0.012);
    const ep = (p - ec) / d.vec2f(1, std.max(open, 0.06));
    const almond = sdEllipse(ep, d.vec2f(0.016, 0.0074));
    const white = fillF(almond, aa);
    col = std.mix(col, SCLERA, white);
    const ic = ep - d.vec2f(pupil.x * 0.0065, pupil.y * 0.0028);
    col = std.mix(col, IRIS, fillF(std.length(ic) - 0.0066, aa) * white);
    col = std.mix(col, PUPIL, fillF(std.length(ic) - 0.0028, aa) * white);
    col = std.mix(col, LID, lineF(almond, 0.0011, aa) * std.smoothstep(-0.004, 0.002, ep.y) * 0.9);
    const brow = lineF(std.length(p - d.vec2f(sx * 0.024, -0.02)) - 0.05, 0.0012, aa) * std.smoothstep(0.02, 0.012, std.abs(p.x - sx * 0.026)) * std.step(0.024, p.y);
    col = std.mix(col, LID, brow * 0.7);
  }
  col = std.mix(col, col * 0.86, lineF(sdSeg(p, d.vec2f(0.003, 0.004), d.vec2f(0.006, -0.026)), 0.0015, aa));
  col = std.mix(col, LID, fillF(std.length(std.abs(p - d.vec2f(0, -0.03)) - d.vec2f(0.007, 0)) - 0.0022, aa) * 0.5);
  const m = sdEllipse(p - d.vec2f(0, -0.052), d.vec2f(0.013, 0.0046));
  col = std.mix(col, LIPS, fillF(m, aa));
  col = std.mix(col, LIPS * 0.6, lineF(p.y + 0.052, 0.0008, aa) * fillF(m, aa));
  return col;
});

/* colour of a lady at (da = angle from her facing direction, y = height in metres) */
export const ladyColor = tgpu.fn([d.f32, d.f32, d.f32, d.u32, d.vec2f, d.f32, d.f32], d.vec3f)((da, y, s, pal, pupil, blink, aa) => {
  'use gpu';
  const H = LADY_H * s;
  const t = y / H;
  const r = std.max(ladyRadius(y, s), 0.02 * s);
  const u = da * r;
  // the face: a pale oval on the front of the head
  const p = d.vec2f(u, y - (H - 0.132 * s)) / s;
  const faceM = fillF(sdEllipse(p, d.vec2f(0.052, 0.08)), aa / s) * std.step(std.abs(da), 1.4);
  // hair: covers the head around the face, falls over the shoulders as a cape parted in a V below
  // the face, and on down her back in long strands
  const headZone = std.smoothstep(H - 0.27 * s, H - 0.22 * s, y);
  const ad = std.abs(da);
  const sn = perlin2d.sample(d.vec2f(da * 9, y * 0.8 + d.f32(pal) * 3)) * 0.4;
  const ragged = perlin2d.sample(d.vec2f(da * 14, d.f32(pal) * 7.3)) * 0.07;
  const vOpen = 0.16 + std.max(0.86 - t, 0) * 2.4;
  const cape = std.smoothstep(vOpen - 0.1, vOpen + 0.1, ad + sn) * std.smoothstep(capeEnd.$[pal] - 0.03, capeEnd.$[pal] + 0.05, t + ragged);
  const he = hairEnd.$[pal];
  const back = std.smoothstep(1.7, 2.0, ad + sn) * std.smoothstep(he - 0.04, he + 0.12, t + ragged);
  const hairM = std.mix(std.max(cape, back), 1 - faceM, headZone);
  const strand = perlin2d.sample(d.vec2f(da * 46, y * 2.2)) * 0.5 + 0.5;
  const hairCol = std.mix(hairDark.$[pal], hairLight.$[pal], std.smoothstep(0.2, 0.8, strand));
  // the cloak: loose dabs on a light ground, thinning towards the hem, where the meadow shows through
  const st = strokes(d.vec2f(u, y), 0.021, 0.03, 0.021, d.vec2f(0.45, 0.89), 2.6, std.mix(0.5, 0.96, std.smoothstep(0.04, 0.45, t)), d.f32(pal) * 17 + 3);
  const dab = cloakPal.$[pal * 6 + d.u32(std.min(std.floor(st.r1 * 6), 5))] * (0.88 + st.r2 * 0.22);
  const hem = std.smoothstep(0.0, 0.2, t);
  const ground = std.mix(MEADOW, GROUND, hem);
  let col = std.mix(ground, dab, st.hit * std.smoothstep(0.0, 0.25, st.edge) * (0.55 + 0.45 * hem));
  col = std.mix(col, hairCol, std.clamp(hairM, 0, 1));
  if (faceM > 0.001) {
    const face = ladyFace(p, pupil, std.max(1 - blink, 0.06), aa / s);
    col = std.mix(col, face, faceM);
  }
  return col;
});
