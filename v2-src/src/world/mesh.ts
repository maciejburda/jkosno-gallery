/* Interleaved vertex builder for the merged static mesh.
   Layout (40 bytes): pos f32x3 · nrm f32x3 · uv f32x2 · col unorm8x4 (sRGB rgb + param) · info u32
   info = mat | room << 8 | group << 16 | layer << 24 */

export const Mat = {
  Plaster: 0,   // walls — analytic world-space plaster
  Floor: 1,     // baked floor recipe (layer = room), planar reflections
  Matte: 2,     // ceiling, cornice, panel trim
  Wood: 3,      // skirting, jambs, benches
  Emissive: 4,  // ceiling light panels (col.a = intensity)
  Label: 5,     // canvas-drawn labels from the atlas (layer = atlas page)
  Fabric: 6,    // bench cushions
  Key: 7,       // the little keys (metal + glow)
  Metal: 8,     // lamp bodies, legs, fittings (col.a = roughness)
  Glass: 9,     // lit glass shades and globes (col.a = glow)
  Paper: 10,    // paper and linen shades, alabaster (col.a = glow)
  Leather: 11,  // button-tufted upholstery
  Enamel: 12,   // glossy painted metal / lacquer
} as const;

/* furniture surfaces (vertex `layer` on Wood / Fabric / Leather / Matte / Enamel / Metal; render/furniture.ts) */
export const TX = {
  None: 0, Grain: 1, Velvet: 2, Fleece: 3, Rope: 4, Leather: 5, Felt: 6, Painted: 7, CastIron: 8, Bark: 9, EndGrain: 10, Gilt: 11,
} as const;

export const STRIDE = 40;
export type V3 = readonly [number, number, number];

export interface VertexAttrs {
  col: readonly [number, number, number, number]; // 0..1, sRGB rgb + param
  mat: number; room: number; group?: number; layer?: number;
  uv?: (p: V3) => [number, number];               // texture coordinates (metres) for the shapes helpers
}

export class MeshBuilder {
  private buf = new ArrayBuffer(STRIDE * 4096);
  private f32 = new Float32Array(this.buf);
  private u32 = new Uint32Array(this.buf);
  private u8 = new Uint8Array(this.buf);
  count = 0;

  private grow() {
    const nb = new ArrayBuffer(this.buf.byteLength * 2);
    new Uint8Array(nb).set(this.u8);
    this.buf = nb; this.f32 = new Float32Array(nb); this.u32 = new Uint32Array(nb); this.u8 = new Uint8Array(nb);
  }

  vertex(p: V3, n: V3, u: number, v: number, a: VertexAttrs) {
    if ((this.count + 1) * STRIDE > this.buf.byteLength) this.grow();
    const o = this.count * (STRIDE / 4);
    this.f32[o] = p[0]; this.f32[o + 1] = p[1]; this.f32[o + 2] = p[2];
    this.f32[o + 3] = n[0]; this.f32[o + 4] = n[1]; this.f32[o + 5] = n[2];
    this.f32[o + 6] = u; this.f32[o + 7] = v;
    const b = (o + 8) * 4;
    for (let k = 0; k < 4; k++) this.u8[b + k] = Math.max(0, Math.min(255, Math.round(a.col[k] * 255)));
    this.u32[o + 9] = (a.mat & 255) | ((a.room & 255) << 8) | (((a.group ?? 0) & 255) << 16) | (((a.layer ?? 0) & 255) << 24);
    this.count++;
  }

  /* quad spanned from origin o by edges eu, ev (front face = eu × ev); uv rect [u0,v0]-[u1,v1] */
  quad(o: V3, eu: V3, ev: V3, a: VertexAttrs, uv: readonly [number, number, number, number] = [0, 0, 1, 1]) {
    const n = normalize(cross(eu, ev));
    const p1 = add(o, eu), p2 = add(add(o, eu), ev), p3 = add(o, ev);
    const [u0, v0, u1, v1] = uv;
    // uv: v grows "down" the edge ev in texture space (top-left origin), so flip
    this.vertex(o, n, u0, v1, a); this.vertex(p1, n, u1, v1, a); this.vertex(p2, n, u1, v0, a);
    this.vertex(o, n, u0, v1, a); this.vertex(p2, n, u1, v0, a); this.vertex(p3, n, u0, v0, a);
  }

  /* axis-aligned box centred at c with full size s; faces: px nx py ny pz nz */
  box(c: V3, s: V3, a: VertexAttrs, faces = 'px nx py ny pz nz') {
    const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
    const [x, y, z] = c;
    const F = faces.split(' ');
    if (F.includes('px')) this.quad([x + hx, y - hy, z + hz], [0, 0, -s[2]], [0, s[1], 0], a);
    if (F.includes('nx')) this.quad([x - hx, y - hy, z - hz], [0, 0, s[2]], [0, s[1], 0], a);
    if (F.includes('py')) this.quad([x - hx, y + hy, z + hz], [s[0], 0, 0], [0, 0, -s[2]], a);
    if (F.includes('ny')) this.quad([x - hx, y - hy, z - hz], [s[0], 0, 0], [0, 0, s[2]], a);
    if (F.includes('pz')) this.quad([x - hx, y - hy, z + hz], [s[0], 0, 0], [0, s[1], 0], a);
    if (F.includes('nz')) this.quad([x + hx, y - hy, z - hz], [-s[0], 0, 0], [0, s[1], 0], a);
  }

  /* torus in the local xy plane (for the key ring), transformed by fn */
  torus(R: number, r: number, segU: number, segV: number, a: VertexAttrs, xf: (p: V3) => V3, xn: (n: V3) => V3) {
    const P = (i: number, j: number): [V3, V3] => {
      const u = i / segU * Math.PI * 2, v = j / segV * Math.PI * 2;
      const cx = Math.cos(u), cy = Math.sin(u);
      const n: V3 = [cx * Math.cos(v), cy * Math.cos(v), Math.sin(v)];
      return [[(R + r * Math.cos(v)) * cx, (R + r * Math.cos(v)) * cy, r * Math.sin(v)], n];
    };
    for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
      const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      for (const k of [0, 1, 2, 0, 2, 3]) this.vertex(xf(q[k][0]), xn(q[k][1]), 0, 0, a);
    }
  }

  bytes(): ArrayBuffer { return this.buf.slice(0, this.count * STRIDE); }
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const normalize = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function hexCol(hex: string, param = 1): [number, number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255, param];
}
