/* Per-room look (same palette as v1 STYLES / landing ROOM_META): wall colour, accent,
   floor recipe. Floors are baked on the GPU from these recipes (render/floorBake.ts). */
import { rooms } from './layout.ts';

export const FloorKind = { Marble: 0, Chevron: 1, Planks: 2, Stone: 3, Terrazzo: 4, Basket: 5 } as const;
export type FloorKind = typeof FloorKind[keyof typeof FloorKind];

export interface FloorRecipe {
  kind: FloorKind;
  hue: number; sat: number; light: number;   // HSL, like the v1 canvas recipes
  rows: number;                               // planks per tile
  gap: number;                                // joint darkness
  polish: number;                             // 0 matte … 1 mirror-like lacquer
}
export interface RoomStyle { wall: string; accent: string; fscale: number; floor: FloorRecipe }

const F = (kind: FloorKind, o: Partial<FloorRecipe> = {}): FloorRecipe =>
  ({ kind, hue: 33, sat: 36, light: 44, rows: 11, gap: 0.5, polish: 0.32, ...o });

export const STYLES: Record<string, RoomStyle> = {
  '__lobby':               { wall: '#d8cec0', accent: '#b08d4f', fscale: 1.8, floor: F(FloorKind.Marble, { polish: 0.62 }) },
  'Paryż i Wenecja':       { wall: '#4b5d70', accent: '#c8a165', fscale: 2.6, floor: F(FloorKind.Chevron, { hue: 33, sat: 36, light: 44 }) },
  'Pejzaże':               { wall: '#8f977c', accent: '#5d6647', fscale: 3.0, floor: F(FloorKind.Planks, { hue: 36, sat: 30, light: 52 }) },
  'Tatry i góry':          { wall: '#a4adb4', accent: '#4f5b66', fscale: 3.0, floor: F(FloorKind.Stone, { hue: 210, sat: 7, light: 50, polish: 0.2 }) },
  'Miasta polskie':        { wall: '#9c5b40', accent: '#d9a05b', fscale: 3.0, floor: F(FloorKind.Planks, { hue: 22, sat: 34, light: 30, rows: 9 }) },
  'Mariny':                { wall: '#2f4457', accent: '#7fa3b8', fscale: 3.4, floor: F(FloorKind.Planks, { hue: 33, sat: 12, light: 50, rows: 12, gap: 0.6, polish: 0.22 }) },
  'Impresje i abstrakcje': { wall: '#e7e0d1', accent: '#c67a4e', fscale: 2.2, floor: F(FloorKind.Terrazzo, { polish: 0.45 }) },
  'Sceny i symbolizm':     { wall: '#6e3439', accent: '#c98f4c', fscale: 2.6, floor: F(FloorKind.Chevron, { hue: 22, sat: 30, light: 26, polish: 0.4 }) },
  'Portrety i akty':       { wall: '#41544a', accent: '#c9a25e', fscale: 2.2, floor: F(FloorKind.Basket, { hue: 17, sat: 30, light: 29 }) },
  'Rysunki i dyptyki':     { wall: '#4c4844', accent: '#a8a29a', fscale: 2.4, floor: F(FloorKind.Planks, { hue: 38, sat: 24, light: 60, rows: 14, gap: 0.45 }) },
  '__secret':              { wall: '#2c3152', accent: '#7f8fd8', fscale: 2.6, floor: F(FloorKind.Chevron, { hue: 232, sat: 18, light: 24, polish: 0.5 }) },
};
export const FEATURE_WALL = '#2a211b';   // espresso feature wall behind the lobby title
export const SECRET_WALL = STYLES['__secret'].wall;

export const styleOfRoom = (i: number): RoomStyle => {
  const r = rooms[i];
  return r.lobby ? STYLES['__lobby'] : STYLES[r.name];
};

/* every room gets its own baked floor layer */
export const floorRecipes: FloorRecipe[] = rooms.map((_, i) => styleOfRoom(i).floor);

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}
export const srgbToLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
export const hexLinear = (hex: string) => hexToRgb(hex).map(srgbToLinear) as [number, number, number];
