/* Small GPU helpers shared by every pipeline ('use gpu' → WGSL via unplugin-typegpu). */
import { tgpu, d, std } from 'typegpu';

export const srgbToLinear = (c: d.v3f) => {
  'use gpu';
  return std.pow(std.max(c, d.vec3f(0)), d.vec3f(2.2));
};

export const linearToSrgb = (c: d.v3f) => {
  'use gpu';
  const lo = c * 12.92;
  const hi = std.pow(std.max(c, d.vec3f(0.0031308)), d.vec3f(1 / 2.4)) * 1.055 - 0.055;
  return std.select(hi, lo, std.le(c, d.vec3f(0.0031308)));
};

/* Khronos PBR Neutral tone mapping — keeps base colours (i.e. the paintings) faithful
   up to ~0.76 and only rolls off highlights. */
export const tonemapNeutral = (colIn: d.v3f) => {
  'use gpu';
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  const x = std.min(colIn.x, std.min(colIn.y, colIn.z));
  const offset = std.select(d.f32(0.04), x - 6.25 * x * x, x < 0.08);
  const col = colIn - offset;
  const peak = std.max(col.x, std.max(col.y, col.z));
  if (peak < startCompression) {
    return d.vec3f(col);
  }
  const dd = 1 - startCompression;
  const newPeak = 1 - dd * dd / (peak + dd - startCompression);
  const scaled = col * (newPeak / peak);
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return std.mix(scaled, d.vec3f(newPeak), g);
};

export const luminance = (c: d.v3f) => {
  'use gpu';
  return std.dot(c, d.vec3f(0.2126, 0.7152, 0.0722));
};

/* GGX / Trowbridge-Reitz distribution × Smith-Schlick visibility (no Fresnel) */
export const ggxSpec = tgpu.fn([d.vec3f, d.vec3f, d.vec3f, d.f32], d.f32)((N, V, L, rough) => {
  'use gpu';
  const H = std.normalize(V + L);
  const NdH = std.max(std.dot(N, H), 0);
  const NdV = std.max(std.dot(N, V), 0.001);
  const NdL = std.max(std.dot(N, L), 0);
  const a = std.max(rough * rough, 0.002);
  const a2 = a * a;
  const dn = NdH * NdH * (a2 - 1) + 1;
  const D = a2 / (Math.PI * dn * dn);
  const k = a * 0.5;
  const vis = 1 / ((NdV * (1 - k) + k) * (NdL * (1 - k) + k));
  return D * vis * 0.25 * NdL;
});

export const fresnel = tgpu.fn([d.f32, d.f32], d.f32)((f0, cosT) => {
  'use gpu';
  const m = 1 - std.clamp(cosT, 0, 1);
  const m2 = m * m;
  return f0 + (1 - f0) * m2 * m2 * m;
});

/* signed distance to an axis-aligned box in 2D (half-extents b) */
export const sdBox = tgpu.fn([d.vec2f, d.vec2f], d.f32)((p, b) => {
  'use gpu';
  const q = std.abs(p) - b;
  return std.length(std.max(q, d.vec2f(0))) + std.min(std.max(q.x, q.y), 0);
});

export const hsl2rgb = tgpu.fn([d.f32, d.f32, d.f32], d.vec3f)((h, s, l) => {
  'use gpu';
  const k = std.fract(d.vec3f(0, 8, 4) / 12 + h / 360) * 12;
  const a = s * std.min(l, 1 - l);
  const v = l - a * std.clamp(std.min(k - 3, 9 - k), d.vec3f(-1), d.vec3f(1));
  return v;
});
