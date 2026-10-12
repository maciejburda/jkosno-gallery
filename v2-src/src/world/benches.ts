/* One bench per room, each in the room's own style (themes.ts):
   Paris – a crimson velvet banquette on gilt cabriole legs · Landscapes – a live-edge oak slab on log
   trestles · Tatra – a carved Zakopane bench with a sheepskin · Polish cities – a Planty park bench ·
   Marines – a slatted teak deck bench with a coil of rope · Impressions – tubular chrome and cognac
   leather · Scenes – a round velvet borne with a palm · Portraits – a button-tufted leather
   Chesterfield bench · Drawings – a plan chest to sit on · the secret room – a low hinoki bench.
   Built in a local frame (x along the bench, z its depth, y up) and merged into the static mesh. */
import { MeshBuilder, Mat, hexCol, type V3, type VertexAttrs, add } from './mesh.ts';
import { lathe, cyl, tube, sphere, boxF, roundBox, frameAt, toWorld, tri, type Frame3 } from './shapes.ts';
import { BenchKind } from './themes.ts';

export interface BenchRec { room: number; x: number; z: number; rotY: number; kind: number }

const A = (mat: number, hex: string, w: number, room: number): VertexAttrs => ({ col: hexCol(hex, w), mat, room });

export function buildBench(mb: MeshBuilder, b: BenchRec, metal: string) {
  const f = frameAt([b.x, 0, b.z], [0, 1, 0], [Math.cos(b.rotY), 0, -Math.sin(b.rotY)]);
  const P = (p: V3) => toWorld(f, p);
  const sub = (c: V3): Frame3 => ({ o: P(c), x: f.x, y: f.y, z: f.z });
  const lbox = (c: V3, h: V3, a: VertexAttrs, faces?: string) => boxF(mb, sub(c), h, a, faces);
  const r = b.room;
  const wood = (hex: string, rough = 0.5) => A(Mat.Wood, hex, rough, r);
  const met = (hex: string, rough = 0.3) => A(Mat.Metal, hex, rough, r);

  switch (b.kind) {
    case BenchKind.Banquette: {      // Paris: crimson velvet on gilt cabriole legs
      const gilt = met('#c9a05a', 0.32);
      roundBox(mb, sub([0, 0.45, 0]), [1.0, 0.075, 0.28], 0.06, 7, A(Mat.Fabric, '#7a2232', 0.95, r));
      lbox([0, 0.355, 0], [1.02, 0.03, 0.29], gilt, 'px nx pz nz ny');
      for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) {
        const x = sx * 0.95, z = sz * 0.25;
        tube(mb, [P([x, 0.34, z]), P([x + sx * 0.02, 0.24, z + sz * 0.04]), P([x - sx * 0.01, 0.1, z + sz * 0.01]), P([x + sx * 0.03, 0.02, z + sz * 0.03])], 0.022, 8, gilt);
      }
      break;
    }
    case BenchKind.LiveEdge: {       // Landscapes: an oak slab with its natural edges, on two logs
      const oak = wood('#9a6a3c', 0.55);
      const n = 24, top = 0.47, bot = 0.4;
      const edge = (i: number, s: number) => s * (0.27 + 0.035 * Math.sin(i * 1.7 + s * 2) + 0.02 * Math.sin(i * 4.1));
      const pt = (i: number, s: number, y: number): V3 => P([-1.1 + 2.2 * i / n, y, edge(i, s)]);
      for (let i = 0; i < n; i++) {
        const up: V3 = f.y, dn: V3 = [-f.y[0], -f.y[1], -f.y[2]];
        tri(mb, [pt(i, -1, top), pt(i + 1, -1, top), pt(i + 1, 1, top)], [up, up, up], oak, up);
        tri(mb, [pt(i, -1, top), pt(i + 1, 1, top), pt(i, 1, top)], [up, up, up], oak, up);
        tri(mb, [pt(i, -1, bot), pt(i + 1, 1, bot), pt(i + 1, -1, bot)], [dn, dn, dn], oak, dn);
        tri(mb, [pt(i, -1, bot), pt(i, 1, bot), pt(i + 1, 1, bot)], [dn, dn, dn], oak, dn);
        for (const s of [-1, 1]) {
          const out = add([0, 0, 0], [f.z[0] * s, f.z[1] * s, f.z[2] * s]);
          const q: [V3, V3, V3, V3] = [pt(i, s, bot), pt(i + 1, s, bot), pt(i + 1, s, top), pt(i, s, top)];
          tri(mb, [q[0], q[1], q[2]], [out, out, out], wood('#6e4a2a', 0.7), out);
          tri(mb, [q[0], q[2], q[3]], [out, out, out], wood('#6e4a2a', 0.7), out);
        }
      }
      for (const s of [-1, 1]) lbox([s * 1.1, (top + bot) / 2, 0], [0.004, (top - bot) / 2, 0.27], wood('#6e4a2a', 0.7), s > 0 ? 'px' : 'nx');
      for (const x of [-0.75, 0.75]) {
        cyl(mb, P([x, 0, 0]), P([x, bot, 0]), 0.17, 14, wood('#5e4026', 0.8), false, 0.15);
        lathe(mb, frameAt(P([x, bot - 0.001, 0])), [[0.001, 0], [0.15, 0]], 14, wood('#b88a58', 0.6));
      }
      break;
    }
    case BenchKind.Zakopane: {       // Tatra: light spruce, carved backrest, a sheepskin
      const spruce = wood('#c89a5e', 0.55);
      lbox([0, 0.44, 0.02], [1.0, 0.03, 0.22], spruce);
      for (const x of [-0.85, 0.85]) {
        lbox([x, 0.205, 0.02], [0.03, 0.205, 0.2], spruce);
        lbox([x, 0.08, 0.02], [0.031, 0.025, 0.12], wood('#7a5230', 0.6));   // a darker carved band
      }
      lbox([0, 0.97, -0.2], [1.02, 0.05, 0.03], spruce);
      lbox([0, 0.5, -0.2], [1.0, 0.03, 0.025], spruce);
      for (let k = 0; k < 9; k++) {
        const x = -0.8 + 1.6 * k / 8;
        lbox([x, 0.73, -0.2], [0.035, 0.2, 0.018], spruce);
        // the lozenge carved into every baluster
        boxF(mb, { o: P([x, 0.75, -0.18]), x: f.x, y: f.y, z: f.z }, [0.025, 0.04, 0.005], wood('#7a5230', 0.6), 'pz');
      }
      roundBox(mb, sub([0.45, 0.47, 0.03]), [0.42, 0.03, 0.21], 0.03, 5, A(Mat.Fabric, '#efe6d4', 1, r));
      break;
    }
    case BenchKind.Planty: {         // Polish cities: a Kraków Planty park bench
      const iron = met('#1e2420', 0.55);
      const green = A(Mat.Enamel, '#3d6a46', 0.3, r);
      for (const x of [-0.85, 0.85]) {
        tube(mb, [P([x, 0, 0.27]), P([x, 0.2, 0.25]), P([x, 0.42, 0.24]), P([x, 0.41, -0.18]), P([x, 0.62, -0.26]), P([x, 0.86, -0.33])], 0.017, 8, iron);
        tube(mb, [P([x, 0.41, -0.18]), P([x, 0.2, -0.22]), P([x, 0, -0.27])], 0.017, 8, iron);
      }
      for (let k = 0; k < 5; k++) lbox([0, 0.445, 0.2 - k * 0.095], [1.0, 0.014, 0.036], green);
      for (let k = 0; k < 3; k++) {
        const y = 0.6 + k * 0.1, zz = -0.23 - k * 0.035;
        boxF(mb, { o: P([0, y, zz]), x: f.x, y: f.y, z: f.z }, [1.0, 0.035, 0.012], green);
      }
      break;
    }
    case BenchKind.Deck: {           // Marines: teak slats, brass caps, a coil of rope
      const teak = wood('#9a6436', 0.45);
      const brass = met('#c8a060', 0.3);
      for (let k = 0; k < 7; k++) lbox([0, 0.44, -0.24 + k * 0.08], [0.98, 0.02, 0.032], teak);
      for (const x of [-0.85, 0.85]) {
        lbox([x, 0.21, 0], [0.04, 0.21, 0.27], teak);
        for (const z of [-0.26, 0.26]) lbox([x, 0.02, z], [0.045, 0.02, 0.025], brass);
      }
      lbox([0, 0.12, 0], [0.82, 0.025, 0.04], teak);
      for (let k = 0; k < 3; k++) {
        const prof: [number, number][] = [];
        for (let j = 0; j <= 8; j++) { const t = j / 8 * Math.PI * 2; prof.push([0.13 - k * 0.02 + 0.022 * Math.cos(t), 0.022 * Math.sin(t)]); }
        lathe(mb, frameAt(P([0.62, 0.48 + k * 0.04, 0.02])), prof, 18, A(Mat.Matte, '#c8b48a', 0.95, r));
      }
      break;
    }
    case BenchKind.Chrome: {         // Impressions: tubular chrome and cognac leather
      const chrome = met('#dfe3e8', 0.1);
      for (const x of [-0.82, 0.82]) {
        tube(mb, [P([x, 0.02, 0.26]), P([x, 0.36, 0.26]), P([x, 0.36, -0.26]), P([x, 0.02, -0.26])], 0.016, 10, chrome);
        cyl(mb, P([x, 0.02, -0.26]), P([x, 0.02, 0.26]), 0.016, 10, chrome, false);
      }
      for (const z of [-0.24, 0.24]) cyl(mb, P([-0.82, 0.36, z]), P([0.82, 0.36, z]), 0.014, 10, chrome, false);
      roundBox(mb, sub([0, 0.42, 0]), [0.98, 0.05, 0.3], 0.04, 7, A(Mat.Leather, '#9a5a2a', 0.5, r));
      break;
    }
    case BenchKind.Borne: {          // Scenes & symbolism: a round tufted velvet borne with a palm
      const velvet = A(Mat.Fabric, '#b08a3c', 0.95, r);
      lathe(mb, frameAt(P([0, 0, 0])), [[0.7, 0.0], [0.74, 0.08], [0.78, 0.3], [0.75, 0.42], [0.68, 0.47], [0.36, 0.48]], 40, velvet);
      lathe(mb, frameAt(P([0, 0, 0])), [[0.36, 0.48], [0.34, 0.62], [0.24, 0.95], [0.16, 1.02], [0.001, 1.03]], 32, velvet);
      lathe(mb, frameAt(P([0, 0, 0])), [[0.7, -0.001], [0.7, 0.04]], 40, wood('#3a2416', 0.5));
      const brass = met('#c8a060', 0.28);
      lathe(mb, frameAt(P([0, 1.02, 0])), [[0.08, 0], [0.13, 0.08], [0.14, 0.2], [0.12, 0.24], [0.13, 0.25]], 20, brass);
      for (let k = 0; k < 9; k++) {
        const a = k * Math.PI * 2 / 9, len = 0.55 + (k % 3) * 0.12;
        const pts: V3[] = [];
        for (let j = 0; j <= 8; j++) {
          const t = j / 8;
          pts.push(P([Math.cos(a) * len * t, 1.25 + Math.sin(t * 2.4) * 0.35 * len - t * t * 0.25, Math.sin(a) * len * t]));
        }
        tube(mb, pts, 0.008, 5, A(Mat.Matte, '#4a6a38', 0.8, r));
        for (let j = 1; j < 8; j++) sphere(mb, pts[j], 0.075 - j * 0.006, 6, A(Mat.Matte, j % 2 ? '#567a40' : '#4a6e36', 0.8, r), 0.22);
      }
      break;
    }
    case BenchKind.Chesterfield: {   // Portraits: oxblood leather, button-tufted, rolled ends
      const leather = A(Mat.Leather, '#7a2c1e', 0.5, r);
      roundBox(mb, sub([0, 0.36, 0]), [0.94, 0.11, 0.32], 0.07, 8, leather);
      for (const s of [-1, 1]) {
        cyl(mb, P([s * 1.0, 0.44, -0.33]), P([s * 1.0, 0.44, 0.33]), 0.12, 16, leather, true);
        lbox([s * 0.99, 0.3, 0], [0.1, 0.16, 0.32], leather, s > 0 ? 'px pz nz' : 'nx pz nz');
      }
      for (const x of [-0.98, 0.98]) for (const z of [-0.26, 0.26]) {
        lathe(mb, frameAt(P([x, 0, z])), [[0.035, 0.0], [0.04, 0.05], [0.03, 0.1], [0.045, 0.14], [0.04, 0.15]], 10, wood('#3a2416', 0.4));
        sphere(mb, P([x, 0.02, z]), 0.022, 8, met('#c8a060', 0.3));
      }
      break;
    }
    case BenchKind.PlanChest: {      // Drawings: a low plan chest with brass pulls, a felt top
      const oak = wood('#c8b08a', 0.5);
      lbox([0, 0.22, 0], [1.0, 0.2, 0.35], oak);
      lbox([0, 0.025, 0], [0.97, 0.025, 0.33], wood('#3a3028', 0.6));
      roundBox(mb, sub([0, 0.43, 0]), [1.0, 0.016, 0.35], 0.012, 4, A(Mat.Fabric, '#4e5a4a', 0.95, r));
      for (let k = 0; k < 4; k++) {
        const y = 0.09 + k * 0.088;
        for (const s of [-1, 1]) {
          lbox([0, y, s * 0.352], [0.95, 0.036, 0.004], wood('#d6c09c', 0.45), s > 0 ? 'pz' : 'nz');
          for (const x of [-0.45, 0.45]) lbox([x, y, s * 0.36], [0.05, 0.009, 0.006], met('#c09452', 0.3));
        }
      }
      break;
    }
    case BenchKind.Hinoki: {         // the secret room: a low hinoki-wood bench
      const hinoki = wood('#dcc090', 0.5);
      lbox([0, 0.38, 0], [0.8, 0.025, 0.2], hinoki);
      for (const x of [-0.62, 0.62]) lbox([x, 0.18, 0], [0.03, 0.18, 0.18], hinoki);
      lbox([0, 0.12, 0], [0.6, 0.02, 0.02], A(Mat.Enamel, '#1a1410', 0.2, r));
      break;
    }
  }
}
