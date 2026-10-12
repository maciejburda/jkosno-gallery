/* Builds everything static about the museum on the CPU, once:
   - one merged vertex buffer for walls, floors, ceilings, trims, panels, labels, benches, keys
   - the picture-light table, the per-room table and the ceiling-panel list
   Geometry follows v1 (3d.html "build architecture" … "benches") with the same dimensions. */
import {
  rooms, placements, END_X, WALL_H, WALL_T, ROOM_W, DOOR_W, DOOR_H, SECRET_ROOM, SECRET_X0, SECRET_X1,
  panelXs, benches, ROMAN, roomsData, publicCount, normalOf, rightOf, roomAt, PORTRAIT,
  type Placement,
} from './layout.ts';
import { styleOfRoom, FEATURE_WALL, SECRET_WALL, hexLinear, type RoomStyle } from './styles.ts';
import { MeshBuilder, Mat, hexCol, type V3, type VertexAttrs, add, scale } from './mesh.ts';
import { LabelAtlas, drawText, drawBio, drawRug, type AtlasRect } from '../textures/labels.ts';
import { type Lang, type T, tGroup } from '../shared/data.ts';

export const FRAME_W = 0.06;     // moulding width around the canvas
export const FRAME_D = 0.062;    // moulding depth off the wall
export const CANVAS_Z = 0.03;    // canvas sits recessed inside the frame

export interface LightRec {
  pos: V3; intensity: number; dir: V3; cosIn: number; center: V3; cosOut: number;
  normal: V3; depth: number; right: V3; half: [number, number]; room: number; minD2: number;
}
export interface RoomRec {
  x0: number; x1: number; lightStart: number; lightCount: number; panelStart: number; panelCount: number;
  fscale: number; polish: number; benchX: number; doorW: number; doorE: number; panelI: number;
  panelColor: V3; layer: number; bounce: V3;
}
export interface World {
  mesh: ArrayBuffer; vertexCount: number;
  lights: LightRec[]; rooms: RoomRec[]; panels: [number, number, number, number][];
  atlas: LabelAtlas;
  debugRects?: Record<string, unknown>;
}

const up: V3 = [0, 1, 0];

/* quad centred at c, facing normal n = right × up */
function plane(mb: MeshBuilder, c: V3, right: V3, upv: V3, w: number, h: number, a: VertexAttrs, uv?: AtlasRect | [number, number, number, number]) {
  const o = add(add(c, scale(right, -w / 2)), scale(upv, -h / 2));
  const r = uv && !Array.isArray(uv) ? [uv.u0, uv.v0, uv.u1, uv.v1] as const : (uv as [number, number, number, number] | undefined);
  mb.quad(o, scale(right, w), scale(upv, h), a, r ?? [0, 0, 1, 1]);
}
const label = (r: AtlasRect, room: number, extra: Partial<VertexAttrs> = {}): VertexAttrs =>
  ({ col: [1, 1, 1, 0.85], mat: Mat.Label, room, layer: r.page, ...extra });

export function buildWorld(lang: Lang, T: T): World {
  const mb = new MeshBuilder();
  const atlas = new LabelAtlas();
  const styles: RoomStyle[] = rooms.map((_, i) => styleOfRoom(i));
  const museumRooms = rooms.filter(r => !r.secret).length;   // lobby + 9

  /* ---------- labels (drawn into the atlas, placed below) ---------- */
  const plaqueRects = new Map<Placement, AtlasRect>();
  for (const p of placements) {
    if (!p.pickable) continue;
    plaqueRects.set(p, atlas.add(192, 130, drawText([
      { text: `№ ${String(p.item.n).padStart(3, '0')}`, font: '500 64px system-ui', dy: 2 },
    ], 256, 172, { bg: '#f4efe3', dot: !!p.item.sold })));
  }
  const roomSigns = rooms.map((r, i) => (r.lobby || r.secret) ? null : atlas.add(1024, 300, drawText([
    { text: `${T('room').toUpperCase()} ${ROMAN[i - 1]}`, font: '600 44px system-ui', ink: '#8a7a66', dy: 6 },
    { text: tGroup(lang, r.name).toUpperCase(), font: '500 78px Georgia', dy: -2 },
    { text: `${roomsData[i - 1].items.length} ${T('plaqueWorks')}`, font: '400 36px system-ui', ink: '#8a7a66', dy: -8 },
  ], 1024, 300, { bg: '#f4efe4', bar: styles[i].accent })));
  const titleRect = atlas.add(1600, 560, drawText([
    { text: 'JAN KOSNO', font: '500 170px Georgia', ink: '#ecdfc6', dy: 8 },
    { text: '1913 – 1996', font: '400 56px Georgia', ink: '#a8917a' },
    { text: T('lobbyLine', { n: publicCount }), font: '500 36px system-ui', ink: '#8d7a66', dy: -4 },
  ], 1600, 560, { bg: null, bar: '#b08d4f' }));
  const bioRect = atlas.add(1024, 1000, drawBio(T, publicCount));
  const capRect = atlas.add(1024, 128, drawText([{ text: T('selfPortrait'), font: '500 56px system-ui', dy: 2 }], 1024, 128, { bg: '#f4efe3' }));
  const rugRect = atlas.add(768, 512, drawRug);
  atlas.pack();

  /* ---------- floors, ceilings, side walls, skirting, cornice (per room) ---------- */
  rooms.forEach((r, i) => {
    const st = styles[i];
    const x0 = r.lobby ? 0 : r.x0 - WALL_T, x1 = r.x1, len = x1 - x0, mid = (x0 + x1) / 2;
    const wall = hexCol(st.wall, 0.9);
    plane(mb, [mid, 0, 0], [1, 0, 0], [0, 0, -1], len, ROOM_W, { col: [1, 1, 1, 1], mat: Mat.Floor, room: i, layer: i });
    plane(mb, [mid, WALL_H, 0], [1, 0, 0], [0, 0, 1], len, ROOM_W, { col: hexCol(r.secret ? '#232744' : '#f3eee2', 0.95), mat: Mat.Matte, room: i });
    for (const s of [-1, 1]) {
      const z = s * ROOM_W / 2;
      const right: V3 = s < 0 ? [1, 0, 0] : [-1, 0, 0];      // inner face points into the room
      plane(mb, [mid, WALL_H / 2, z], right, up, len, WALL_H, { col: wall, mat: Mat.Plaster, room: i });
      // skirting: front + top; cornice: front + bottom
      const sk = hexCol(r.secret ? '#1b1d30' : '#35291f', 0.45);
      plane(mb, [mid, 0.07, z - s * 0.045], right, up, len, 0.14, { col: sk, mat: Mat.Wood, room: i });
      plane(mb, [mid, 0.14, z - s * 0.0225], [1, 0, 0], [0, 0, -1], len, 0.045, { col: sk, mat: Mat.Wood, room: i });
      const cn = hexCol(r.secret ? '#2c3152' : '#efe9db', 0.9);
      plane(mb, [mid, WALL_H - 0.08, z - s * 0.06], right, up, len, 0.16, { col: cn, mat: Mat.Matte, room: i });
      plane(mb, [mid, WALL_H - 0.16, z - s * 0.03], [1, 0, 0], [0, 0, 1], len, 0.06, { col: cn, mat: Mat.Matte, room: i });
    }
  });

  /* ---------- lobby back wall (espresso feature wall) ---------- */
  plane(mb, [0, WALL_H / 2, 0], [0, 0, -1], up, ROOM_W, WALL_H, { col: hexCol(FEATURE_WALL, 0.85), mat: Mat.Plaster, room: 0 });

  /* ---------- boundary walls with doorways (two colour layers) + dark jambs ---------- */
  const segW = (ROOM_W - DOOR_W) / 2;
  const doorWallFaces = (x: number, west: string, east: string, rw: number, re: number) => {
    const faces: [number, string, V3, number][] = [[x, west, [0, 0, 1], rw], [x + WALL_T, east, [0, 0, -1], re]];
    for (const [fx, col, right, room] of faces) {
      const a = { col: hexCol(col, 0.9), mat: Mat.Plaster, room };
      plane(mb, [fx, WALL_H / 2, -(DOOR_W / 2 + segW / 2)], right, up, segW, WALL_H, a);
      plane(mb, [fx, WALL_H / 2, DOOR_W / 2 + segW / 2], right, up, segW, WALL_H, a);
      plane(mb, [fx, DOOR_H + (WALL_H - DOOR_H) / 2, 0], right, up, DOOR_W, WALL_H - DOOR_H, a);
    }
  };
  for (let i = 1; i < museumRooms; i++) {
    const x = rooms[i].x0 - WALL_T;
    doorWallFaces(x, styles[i - 1].wall, styles[i].wall, i - 1, i);
    const jamb = { col: hexCol('#35291f', 0.4), mat: Mat.Wood, room: i };
    mb.box([x + WALL_T / 2, (DOOR_H + 0.03) / 2, -DOOR_W / 2 - 0.02], [WALL_T + 0.06, DOOR_H + 0.03, 0.08], jamb, 'px nx pz nz py');
    mb.box([x + WALL_T / 2, (DOOR_H + 0.03) / 2, DOOR_W / 2 + 0.02], [WALL_T + 0.06, DOOR_H + 0.03, 0.08], jamb, 'px nx pz nz py');
    mb.box([x + WALL_T / 2, DOOR_H + 0.03, 0], [WALL_T + 0.06, 0.1, DOOR_W + 0.12], jamb, 'px nx ny pz nz');
  }

  /* ---------- end wall with the sliding plug + the secret room ---------- */
  const lastRoom = museumRooms - 1;
  {
    const x = END_X - WALL_T;
    doorWallFaces(x, styles[lastRoom].wall, SECRET_WALL, lastRoom, SECRET_ROOM);
    // reveals of the hidden doorway (seen once the plug is down)
    const rv = { col: hexCol(SECRET_WALL, 0.9), mat: Mat.Plaster, room: SECRET_ROOM };
    plane(mb, [x + WALL_T / 2, DOOR_H / 2, -DOOR_W / 2], [1, 0, 0], up, WALL_T, DOOR_H, rv);
    plane(mb, [x + WALL_T / 2, DOOR_H / 2, DOOR_W / 2], [-1, 0, 0], up, WALL_T, DOOR_H, rv);
    plane(mb, [x + WALL_T / 2, DOOR_H, 0], [1, 0, 0], [0, 0, 1], WALL_T, DOOR_W, rv);
    // the plug itself (group 1 slides it into the floor)
    const pc: V3 = [x + WALL_T / 2, DOOR_H / 2, 0];
    plane(mb, [x, DOOR_H / 2, 0], [0, 0, 1], up, DOOR_W, DOOR_H, { col: hexCol(styles[lastRoom].wall, 0.9), mat: Mat.Plaster, room: lastRoom, group: 1 });
    plane(mb, [x + WALL_T, DOOR_H / 2, 0], [0, 0, -1], up, DOOR_W, DOOR_H, { col: hexCol(SECRET_WALL, 0.9), mat: Mat.Plaster, room: SECRET_ROOM, group: 1 });
    plane(mb, [pc[0], DOOR_H, 0], [1, 0, 0], [0, 0, -1], WALL_T, DOOR_W, { col: hexCol(styles[lastRoom].wall, 0.9), mat: Mat.Plaster, room: lastRoom, group: 1 });
    // far wall of the secret room
    plane(mb, [SECRET_X1, WALL_H / 2, 0], [0, 0, 1], up, ROOM_W, WALL_H, { col: hexCol(SECRET_WALL, 0.9), mat: Mat.Plaster, room: SECRET_ROOM });
  }

  /* ---------- recessed ceiling light panels ---------- */
  const panels: [number, number, number, number][] = [];
  const panelRoom: number[] = [];
  for (const x of panelXs) {
    const ri = roomAt(x);
    panels.push([x, WALL_H - 0.01, 0, 0]); panelRoom.push(ri);
    plane(mb, [x, WALL_H - 0.004, 0], [1, 0, 0], [0, 0, 1], 2.86, 1.36, { col: hexCol('#9e968a', 0.8), mat: Mat.Matte, room: ri });
    plane(mb, [x, WALL_H - 0.009, 0], [1, 0, 0], [0, 0, 1], 2.6, 1.1, { col: hexCol('#fff4dd', 1), mat: Mat.Emissive, room: ri });
  }
  {
    const smid = (SECRET_X0 + SECRET_X1) / 2;
    panels.push([smid, WALL_H - 0.01, 0, 0]); panelRoom.push(SECRET_ROOM);
    plane(mb, [smid, WALL_H - 0.009, 0], [1, 0, 0], [0, 0, 1], 2.6, 1.1, { col: hexCol('#cfd8ff', 0.8), mat: Mat.Emissive, room: SECRET_ROOM });
  }

  /* ---------- labels: room signs, plaques, lobby title, bio, caption, rug ---------- */
  rooms.forEach((r, i) => {
    const rs = roomSigns[i]; if (!rs) return;
    plane(mb, [r.x0 - WALL_T - 0.02, DOOR_H + (WALL_H - DOOR_H) / 2, 0], [0, 0, 1], up, 2.6, 0.76, label(rs, i - 1), rs);
  });
  for (const [p, rect] of plaqueRects) {
    const N = normalOf(p), R = rightOf(p);
    const c = add(add([p.cx, p.cy - p.h / 2 + 0.09, p.cz], scale(R, p.w / 2 + 0.19)), scale(N, 0.014));
    plane(mb, c, R, up, 0.17, 0.115, label(rect, p.room), rect);
    // thin card edges
    const e = { col: hexCol('#e8e0cf', 0.9), mat: Mat.Matte, room: p.room };
    const ce = add(c, scale(N, -0.007));
    plane(mb, add(ce, [0, 0.0575, 0]), R, scale(N, -1), 0.17, 0.014, e);
    plane(mb, add(ce, scale(R, 0.085)), scale(N, -1), up, 0.014, 0.115, e);
    plane(mb, add(ce, scale(R, -0.085)), N, up, 0.014, 0.115, e);
  }
  plane(mb, [0.02, 2.15, 0], [0, 0, -1], up, 5.4, 5.4 * 560 / 1600, label(titleRect, 0, { col: [1, 1, 1, 1] }), titleRect);
  plane(mb, [PORTRAIT.cx, PORTRAIT.cy - PORTRAIT.h / 2 - 0.19, PORTRAIT.cz + 0.014], [1, 0, 0], up, 0.78, 0.098, label(capRect, 0), capRect);
  {
    const bw = 2.0, bh = 2.0 * 1000 / 1024, bc: V3 = [5.9, 1.68, -ROOM_W / 2 + 0.03];
    plane(mb, bc, [1, 0, 0], up, bw, bh, label(bioRect, 0), bioRect);
    mb.box([bc[0], bc[1], -ROOM_W / 2 + 0.015], [bw, bh, 0.03], { col: hexCol('#d8cdb8', 0.9), mat: Mat.Matte, room: 0 }, 'px nx py ny');
  }
  plane(mb, [4.7, 0.006, 0], [1, 0, 0], [0, 0, -1], 4.4, 2.9, label(rugRect, 0, { col: [1, 1, 1, 1], mat: Mat.Label }), rugRect);

  /* ---------- benches with a cushion in each room's accent colour ---------- */
  for (const b of benches) {
    const wood = { col: hexCol('#3a2c20', 0.5), mat: Mat.Wood, room: b.room };
    mb.box([b.x, 0.44, 0], [2.2, 0.06, 0.6], wood, 'px nx py ny pz nz');
    mb.box([b.x, 0.515, 0], [2.12, 0.09, 0.54], { col: hexCol(styles[b.room].accent, 0.85), mat: Mat.Fabric, room: b.room }, 'px nx py pz nz');
    mb.box([b.x - 0.92, 0.205, 0], [0.12, 0.41, 0.5], wood, 'px nx pz nz');
    mb.box([b.x + 0.92, 0.205, 0], [0.12, 0.41, 0.5], wood, 'px nx pz nz');
  }

  /* ---------- the two keys, built in their own local space (groups 2 & 3) ---------- */
  const key = (group: number, hex: string, room: number) => {
    const a: VertexAttrs = { col: hexCol(hex, 0.35), mat: Mat.Key, room, group };
    mb.torus(0.05, 0.016, 20, 10, a, p => p, n => n);
    mb.box([0.12, 0, 0], [0.16, 0.024, 0.014], a);
    mb.box([0.17, -0.033, 0], [0.026, 0.05, 0.014], a);
    mb.box([0.13, -0.033, 0], [0.026, 0.05, 0.014], a);
  };
  key(2, '#3b82e6', 1);
  key(3, '#e8862e', SECRET_ROOM);

  /* ---------- picture lights (one per hung work + the biography panel) ---------- */
  const lights: LightRec[] = [];
  const addLight = (C: V3, N: V3, R: V3, hw: number, hh: number, depth: number, room: number, k = 1) => {
    const S = add(add(C, scale(N, 1.55)), [0, WALL_H - 0.2 - C[1], 0]);
    const A: V3 = [C[0], C[1] - 0.1, C[2]];
    const D = [A[0] - S[0], A[1] - S[1], A[2] - S[2]];
    const dist = Math.hypot(D[0], D[1], D[2]);
    const dir: V3 = [D[0] / dist, D[1] / dist, D[2] / dist];
    const cover = Math.hypot(hw, hh) + 0.2;
    lights.push({
      pos: S, intensity: dist * dist * k, dir,
      cosIn: Math.cos(Math.atan(cover * 0.62 / dist)), cosOut: Math.cos(Math.atan((cover + 0.42) / dist)),
      minD2: dist * dist * 0.85,
      center: C, normal: N, right: R, half: [hw, hh], depth, room,
    });
  };
  for (const p of placements) {
    const N = normalOf(p) as V3, R = rightOf(p) as V3;
    addLight([p.cx, p.cy, p.cz], N, R, p.w / 2 + FRAME_W, p.h / 2 + FRAME_W, FRAME_D, p.room);
  }
  addLight([5.9, 1.68, -ROOM_W / 2], [0, 0, 1], [1, 0, 0], 1.0, 0.98, 0.03, 0, 0.8);
  lights.sort((a, b) => a.room - b.room);

  /* ---------- per-room table ---------- */
  const roomRecs: RoomRec[] = rooms.map((r, i) => {
    const st = styles[i];
    const ls = lights.findIndex(l => l.room === i);
    const lc = lights.filter(l => l.room === i).length;
    const ps = panelRoom.indexOf(i);
    const pc = panelRoom.filter(x => x === i).length;
    const bench = benches.find(b => b.room === i);
    const fl = st.floor;
    // light bounced off floor + walls, muted towards a warm grey (feeds the hemisphere's lower half)
    const floorAvg: V3 = fl.kind === 0 ? [0.72, 0.69, 0.63] : fl.kind === 4 ? [0.62, 0.58, 0.52] : hslLinear(fl.hue, fl.sat * 0.6, fl.light);
    const wallLin = hexLinear(st.wall);
    const bounce: V3 = [0, 1, 2].map(k => 0.4 * 0.42 + 0.35 * floorAvg[k] + 0.25 * wallLin[k]) as unknown as V3;
    return {
      x0: r.lobby ? 0 : r.x0, x1: r.x1,
      lightStart: Math.max(0, ls), lightCount: lc, panelStart: Math.max(0, ps), panelCount: pc,
      fscale: st.fscale, polish: fl.polish, benchX: bench ? bench.x : -1000,
      doorW: r.lobby ? 0 : 1, doorE: (i < museumRooms - 1) ? 1 : 0,
      panelI: r.secret ? 0.55 : 1, panelColor: r.secret ? hexLinear('#cfd8ff') : hexLinear('#fff4dd'),
      layer: i, bounce,
    };
  });

  return { mesh: mb.bytes(), vertexCount: mb.count, lights, rooms: roomRecs, panels, atlas, debugRects: { rugRect, titleRect, bioRect, capRect, roomSigns } };
}

function hslLinear(h: number, s: number, l: number): V3 {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const lin = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return [lin(f(0)), lin(f(8)), lin(f(4))];
}
