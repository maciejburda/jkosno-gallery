/* The forest inside painting № 052 — v2 (built in the forest phase). */
import type { TgpuRoot } from 'typegpu';
import type { Renderer } from '../render/renderer.ts';
import type { T } from '../shared/data.ts';
import { S } from '../game/state.ts';
import { EYE } from '../world/layout.ts';

export const FC = [60, 0, 400] as const;

export function createForest(_root: TgpuRoot, renderer: Renderer, _T: T) {
  return {
    fog: { color: [0.9, 0.84, 0.55] as [number, number, number], near: 13, far: 55 },
    ambient: [0.9, 0.82, 0.62] as [number, number, number],
    enter() { S.inForest = true; S.jumpY = 0; S.vy = 0; S.pos = [FC[0], EYE, FC[2] + 3.4]; S.yaw = 0; S.pitch = 0; renderer.setExtension(null); },
    exit() { S.inForest = false; },
    update(_dt: number) {},
    atPortal() { return false; },
    click() {},
    ladiesState() { return [] as { headYaw: number; pupilX: number }[]; },
  };
}
export type Forest = ReturnType<typeof createForest>;
