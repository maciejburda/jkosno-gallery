/* Procedural surfaces for the benches (selected by the vertex `layer` byte, see TX in mesh.ts).
   The bench builders give every vertex texture coordinates in metres with u running along the grain /
   the weave, so the patterns keep their real scale on every part. Each surface returns an albedo
   multiplier, a roughness, a height gradient (for bump mapping through the screen-space cotangent frame),
   a sheen strength (velvet) and a wear factor (worn gilding showing its red bole). */
import { tgpu, d, std } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { TX } from '../world/mesh.ts';

export const FurnTex = d.struct({ mul: d.f32, rough: d.f32, grad: d.vec2f, sheen: d.f32, wear: d.f32 });

export const furnitureTex = tgpu.fn([d.u32, d.vec2f, d.f32], FurnTex)((tex, uv, baseRough) => {
  'use gpu';
  let mul = d.f32(1);
  let rough = d.f32(baseRough);
  let grad = d.vec2f(0);
  let sheen = d.f32(0);
  let wear = d.f32(0);
  if (tex === TX.Grain || tex === TX.Painted) {
    // growth rings across the board (warped), long streaks and open pores along it
    // rings meander along the board into cathedral arches, as on a flat-sawn plank
    const warp = perlin2d.sample(d.vec2f(uv.x * 0.8, uv.y * 5)) * 0.5;
    const arch = perlin2d.sample(d.vec2f(uv.x * 0.35 + 3.7, uv.y * 0.9)) * 0.3 + perlin2d.sample(d.vec2f(uv.x * 1.3, uv.y * 3)) * 0.05;
    // uneven ring spacing (good and bad growing years)
    const rp = (uv.y + warp * 0.05 + arch) * 34 + perlin2d.sample(d.vec2f(uv.y * 9, 1.7)) * 2.5;
    const r = std.fract(rp);
    const band = (std.smoothstep(0.5, 0.82, r) - std.smoothstep(0.88, 1.0, r)) * (0.6 + 0.4 * perlin2d.sample(d.vec2f(std.floor(rp) * 0.37, 0.5)));
    const tone = perlin2d.sample(d.vec2f(uv.x * 0.7, uv.y * 4 + 9.1)) * 0.12;
    const streak = perlin2d.sample(d.vec2f(uv.x * 2.5, uv.y * 70 + warp * 3));
    const pg = perlin2d.sampleWithGradient(d.vec2f(uv.x * 160, uv.y * 640));
    const sg = perlin2d.sampleWithGradient(d.vec2f(uv.x * 6, uv.y * 120));
    if (tex === TX.Grain) {
      mul = 1 + tone + streak * 0.1 - band * 0.34 + pg.x * 0.05;
      rough = baseRough + band * 0.12 - streak * 0.05;
      grad = d.vec2f(pg.y * 160, pg.z * 640) * 0.00016 + d.vec2f(sg.y * 6, sg.z * 120) * 0.0006;
    } else {
      // paint over wood: the grain still shows through as relief, plus long brush marks
      const brush = perlin2d.sample(d.vec2f(uv.x * 3, uv.y * 260));
      mul = 0.97 + brush * 0.05 - band * 0.03;
      grad = d.vec2f(sg.y * 6, sg.z * 120) * 0.0009 + d.vec2f(0, brush * 0.02);
    }
  } else if (tex === TX.Velvet) {
    // short pile, crushed patches that catch the light differently, and deep button tufting
    const patch = perlin2d.sample(uv * 6) * 0.5 + perlin2d.sample(uv * 17 + 3.1) * 0.3;
    const pile = perlin2d.sample(uv * 900) + perlin2d.sample(d.vec2f(uv.x * 30, uv.y * 3)) * 0.6;
    const g = d.vec2f(uv.x + uv.y, uv.x - uv.y) / 0.16;
    const f = std.fract(g) - 0.5;
    const pit = std.exp(-std.dot(f, f) * 22);
    mul = (0.84 + patch * 0.28 + pile * 0.05) * (0.72 + 0.28 * (1 - pit));
    rough = 0.95;
    grad = d.vec2f(f.x + f.y, f.x - f.y) * pit * 1.4;
    sheen = std.clamp(0.7 + patch * 0.9, 0.15, 1.6);
  } else if (tex === TX.Fleece) {
    // curly wool: tight curls with deep valleys between them
    const c = perlin2d.sampleWithGradient(uv * 60);
    const c2 = perlin2d.sampleWithGradient(uv * 170 + 7.7);
    const curl = std.abs(std.sin((c.x + c2.x * 0.5) * 9));
    mul = 0.7 + curl * 0.34;
    rough = 1;
    grad = d.vec2f(c.y, c.z) * 60 * 0.006 + d.vec2f(c2.y, c2.z) * 170 * 0.0016;
    sheen = 0.2;
  } else if (tex === TX.Rope) {
    // three twisted strands, each made of fine fibres
    const ph = (uv.x + uv.y * 0.8) / 0.014 * 6.2832;
    const strand = std.sin(ph);
    const fibre = perlin2d.sample(d.vec2f(uv.x * 600 + uv.y * 480, (uv.y - uv.x) * 60));
    mul = 0.82 + strand * 0.12 + fibre * 0.08;
    rough = 0.95;
    grad = d.vec2f(std.cos(ph), std.cos(ph) * 0.8) * (6.2832 / 0.014) * 0.0006;
  } else if (tex === TX.Leather) {
    // pebbled grain and a soft patina where it has been sat on
    const pg = perlin2d.sampleWithGradient(uv * 320);
    const patina = perlin2d.sample(uv * 6) * 0.5 + 0.5;
    mul = (0.92 + std.abs(pg.x) * 0.12) * (0.94 + patina * 0.12);
    rough = baseRough + std.abs(pg.x) * 0.14 - patina * 0.08;
    grad = d.vec2f(pg.y, pg.z) * 320 * 0.00025;
  } else if (tex === TX.Felt) {
    const f1 = perlin2d.sample(uv * 600);
    mul = 0.92 + f1 * 0.07 + perlin2d.sample(uv * 40) * 0.05;
    rough = 1;
    sheen = 0.12;
  } else if (tex === TX.CastIron) {
    // sand-cast iron: pitted, a little rust in the hollows
    const pg = perlin2d.sampleWithGradient(uv * 260);
    const pit = std.smoothstep(0.1, 0.5, -pg.x);
    mul = 0.85 + pg.x * 0.12;
    rough = std.clamp(baseRough + pit * 0.3, 0, 1);
    grad = d.vec2f(pg.y, pg.z) * 260 * 0.0003;
    wear = pit * 0.4;
  } else if (tex === TX.Bark) {
    // log bark: deep vertical furrows broken into plates
    const fb = perlin2d.sampleWithGradient(d.vec2f(uv.x * 22, uv.y * 3.5));
    const ridge = 1 - std.abs(fb.x) * 2;
    mul = 0.55 + std.max(ridge, 0) * 0.6 + perlin2d.sample(uv * 70) * 0.1;
    rough = 0.95;
    grad = d.vec2f(fb.y * 22, fb.z * 3.5) * std.sign(fb.x) * 0.012;
  } else if (tex === TX.EndGrain) {
    // a sawn log end: growth rings around the pith and a few drying cracks
    const rr = std.length(uv) + perlin2d.sample(uv * 18) * 0.008;
    const ring = std.fract(rr * 75);
    const crack = std.smoothstep(0.985, 1.0, std.sin(std.atan2(uv.y, uv.x) * 5 + perlin2d.sample(uv * 9) * 2)) * std.smoothstep(0.02, 0.08, rr);
    mul = (0.9 + std.smoothstep(0.7, 1.0, ring) * -0.22 + perlin2d.sample(uv * 200) * 0.05) * (1 - crack * 0.7);
    rough = 0.8;
  } else if (tex === TX.Gilt) {
    // worn water gilding: the red bole shows through on the high points
    const w = perlin2d.sample(uv * 38) * 0.6 + perlin2d.sample(uv * 120) * 0.4;
    wear = std.smoothstep(0.42, 0.75, w) * 0.6;
    mul = 0.95 + perlin2d.sample(uv * 300) * 0.05;
    rough = baseRough + wear * 0.35;
  }
  return FurnTex({ mul, rough, grad, sheen, wear });
});

/* bump mapping without stored tangents: the cotangent frame from screen-space derivatives
   (dpx/dpy = derivatives of the position, duvx/duvy of the texture coordinates, all taken in
   uniform control flow by the caller) */
export const bumpNormal = tgpu.fn([d.vec3f, d.vec3f, d.vec3f, d.vec2f, d.vec2f, d.vec2f], d.vec3f)((N, dpx, dpy, duvx, duvy, grad) => {
  'use gpu';
  const dp2perp = std.cross(dpy, N);
  const dp1perp = std.cross(N, dpx);
  const T = dp2perp * duvx.x + dp1perp * duvy.x;
  const B = dp2perp * duvx.y + dp1perp * duvy.y;
  const inv = std.inverseSqrt(std.max(std.max(std.dot(T, T), std.dot(B, B)), 1e-20));
  return std.normalize(N - (T * grad.x + B * grad.y) * inv);
});
