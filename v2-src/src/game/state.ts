/* Mutable visitor state shared by input, movement, UI and the render loop (v1 kept these as module lets). */
import { EYE } from '../world/layout.ts';
import type { Item } from '../shared/data.ts';

export interface FocusAnim {
  t: number;
  from: [number, number, number]; to: [number, number, number];
  fromYaw: number; dYaw: number; fromPitch: number; toPitch: number;
}

export const S = {
  pos: [2.2, EYE, 0] as [number, number, number],
  yaw: -Math.PI / 2,
  pitch: 0,
  vel: [0, 0] as [number, number],
  jumpY: 0, vy: 0,
  keys: {} as Record<string, boolean>,
  locked: false,
  focusItem: null as Item | null,
  focusAnim: null as FocusAnim | null,
  moveVec: { x: 0, y: 0 },
  hasKey: false, hasOrangeKey: false, secretOpen: false,
  plugT: null as number | null,     // 0…1 while the plug slides down
  plugDone: false,
  inForest: false,
  forestReturn: null as { pos: [number, number, number]; yaw: number; pitch: number } | null,
  invY: false,
  entered: false,
  time: 0,
};

export const isTouch = matchMedia('(hover: none)').matches;
