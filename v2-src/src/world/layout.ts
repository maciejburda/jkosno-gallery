/* Museum layout — a 1:1 port of the v1 layout (3d.html "layout" + secret room),
   so positions, deep links and collision behave exactly as in the classic gallery. */
import { KOSNO, type Item } from '../shared/data.ts';

export const ROOM_W = 9;            // interior width (z)
export const WALL_H = 4.2;          // wall height
export const WALL_T = 0.3;          // wall thickness
export const DOOR_W = 2.6, DOOR_H = 3.0;
export const EYE = 1.7, HANG = 1.5; // eye height, painting centre height
export const GAP = 0.75, MARGIN = 1.1;
export const PLAYER_R = 0.35;
export const LOBBY_L = 9;
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

export interface Room { name: string; x0: number; x1: number; lobby?: boolean; secret?: boolean }
export interface Placement {
  item: Item;
  cx: number; cy: number; cz: number;
  rotY: number;
  w: number; h: number;     // overall size in metres (diptych = both panels)
  room: number;             // index into rooms[]
  secret?: boolean;
  pickable: boolean;
}
export interface Box { x0: number; x1: number; z0: number; z1: number }

export const roomsData = KOSNO.groups.map(g => ({ name: g, items: KOSNO.items.filter(i => i.group === g && !i.secret) }));

const unitW = (it: Item) => { const w = it.w / 100; return it.imgs.length > 1 ? w * 2 + 0.06 : w; };

export const rooms: Room[] = [];
export const placements: Placement[] = [];
export const walls: Box[] = [];

rooms.push({ name: 'Wejście', x0: 0, x1: LOBBY_L, lobby: true });
let cursorX = LOBBY_L;

for (const rd of roomsData) {
  const units = rd.items.map(it => ({ it, w: unitW(it) }));
  const total = units.reduce((s, u) => s + u.w, 0);
  let acc = 0, split = units.length;
  for (let i = 0; i < units.length; i++) { acc += units[i].w; if (acc >= total / 2) { split = i + 1; break; } }
  const north = units.slice(0, split), south = units.slice(split);
  const lenOf = (a: typeof units) => a.reduce((s, u) => s + u.w, 0) + GAP * Math.max(0, a.length - 1) + 2 * MARGIN;
  const L = Math.max(lenOf(north), lenOf(south), 8);
  const x0 = cursorX + WALL_T, x1 = x0 + L;
  const ri = rooms.length;
  rooms.push({ name: rd.name, x0, x1 });
  const place = (arr: typeof units, z: number, rotY: number, reverse: boolean) => {
    const content = arr.reduce((s, u) => s + u.w, 0) + GAP * Math.max(0, arr.length - 1);
    let x = x0 + (L - content) / 2;
    for (const u of reverse ? [...arr].reverse() : arr) {
      placements.push({ item: u.it, cx: x + u.w / 2, cy: HANG, cz: z, rotY, w: u.w, h: u.it.h / 100, room: ri, pickable: true });
      x += u.w + GAP;
    }
  };
  place(north, -ROOM_W / 2, 0, false);
  place(south, ROOM_W / 2, Math.PI, true);
  cursorX = x1;
}
export const END_X = cursorX + WALL_T;

/* side walls along the whole enfilade */
for (const s of [-1, 1]) walls.push({ x0: 0, x1: END_X, z0: s > 0 ? ROOM_W / 2 : -ROOM_W / 2 - WALL_T, z1: s > 0 ? ROOM_W / 2 + WALL_T : -ROOM_W / 2 });
/* lobby back wall + boundary walls with doorways */
walls.push({ x0: -WALL_T, x1: 0, z0: -ROOM_W / 2, z1: ROOM_W / 2 });
for (let i = 1; i < rooms.length; i++) {
  const x = rooms[i].x0 - WALL_T;
  walls.push({ x0: x, x1: x + WALL_T, z0: -ROOM_W / 2, z1: -DOOR_W / 2 });
  walls.push({ x0: x, x1: x + WALL_T, z0: DOOR_W / 2, z1: ROOM_W / 2 });
}

/* ---------- secret passage & hidden room ---------- */
export const SECRET_X0 = END_X, SECRET_X1 = END_X + 7;
{
  const x = END_X - WALL_T;
  walls.push({ x0: x, x1: x + WALL_T, z0: -ROOM_W / 2, z1: -DOOR_W / 2 });
  walls.push({ x0: x, x1: x + WALL_T, z0: DOOR_W / 2, z1: ROOM_W / 2 });
  for (const s of [-1, 1]) walls.push({ x0: SECRET_X0, x1: SECRET_X1, z0: s > 0 ? ROOM_W / 2 : -ROOM_W / 2 - WALL_T, z1: s > 0 ? ROOM_W / 2 + WALL_T : -ROOM_W / 2 });
  walls.push({ x0: SECRET_X1, x1: SECRET_X1 + WALL_T, z0: -ROOM_W / 2, z1: ROOM_W / 2 });
}
export const plugWall: Box = { x0: END_X - WALL_T, x1: END_X, z0: -DOOR_W / 2, z1: DOOR_W / 2 };
walls.push(plugWall);

export const SECRET_ROOM = rooms.length;
rooms.push({ name: '__secret', x0: SECRET_X0, x1: SECRET_X1, secret: true });
{
  const it95 = KOSNO.items.find(i => i.n === 95);
  if (it95) placements.push({ item: it95, cx: SECRET_X1, cy: HANG, cz: 0, rotY: -Math.PI / 2, w: it95.w / 100, h: it95.h / 100, room: SECRET_ROOM, secret: true, pickable: true });
}

/* the self-portrait (№107) also hangs in the lobby, next to the biography panel */
export const PORTRAIT = { cx: 2.6, cy: 1.66, cz: -ROOM_W / 2, w: 0.88, h: 0.88 * 60.0 / 40.5 };
{
  const it107 = KOSNO.items.find(i => i.n === 107);
  if (it107) placements.push({ item: it107, cx: PORTRAIT.cx, cy: PORTRAIT.cy, cz: PORTRAIT.cz, rotY: 0, w: PORTRAIT.w, h: PORTRAIT.h, room: 0, pickable: false });
}

/* keys: blue on the floor of Sala I (far right corner), orange inside the secret room */
export const KEY_BLUE = { x: rooms[1].x1 - 0.55, y: 0.05, z: ROOM_W / 2 - 0.5, rz: 0.7 };
export const KEY_ORANGE = { x: SECRET_X0 + 4.6, y: 0.05, z: 2.1, rz: -0.4 };

/* benches in the longer rooms */
export const benches = rooms
  .map((r, i) => ({ r, i }))
  .filter(({ r }) => !r.lobby && !r.secret && r.x1 - r.x0 > 12)
  .map(({ r, i }) => ({ room: i, x: (r.x0 + r.x1) / 2 }));

export const publicCount = KOSNO.items.filter(i => !i.secret).length;

/* geometry helpers for placements */
export const normalOf = (p: Pick<Placement, 'rotY'>) => [Math.sin(p.rotY), 0, Math.cos(p.rotY)] as const;
export const rightOf = (p: Pick<Placement, 'rotY'>) => [Math.cos(p.rotY), 0, -Math.sin(p.rotY)] as const;

export function roomAt(x: number): number {
  if (x >= END_X) return SECRET_ROOM;
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (!r.secret && x >= r.x0 - WALL_T && x < r.x1) return i;
  }
  return 0;
}
