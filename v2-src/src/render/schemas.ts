import { tgpu, d } from 'typegpu';

/* per-pass camera + frame constants (main pass and mirrored reflection pass each get one) */
export const Frame = d.struct({
  viewProj: d.mat4x4f,
  camPos: d.vec3f, time: d.f32,
  fogColor: d.vec3f, fogNear: d.f32,
  viewport: d.vec2f, fogFar: d.f32, exposure: d.f32,
  ambient: d.vec3f, inForest: d.f32,
});

/* a picture light: a ceiling track spot aimed at one painting (or the bio panel);
   the painting's frame rectangle doubles as the occluder for its soft wall shadow */
export const Light = d.struct({
  pos: d.vec3f, intensity: d.f32,
  dir: d.vec3f, cosIn: d.f32,
  center: d.vec3f, cosOut: d.f32,
  normal: d.vec3f, depth: d.f32,
  right: d.vec3f, minD2: d.f32,
  half: d.vec2f, room: d.u32, pad1: d.f32,
});

export const RoomInfo = d.struct({
  x0: d.f32, x1: d.f32,               // interior extent (AO planes)
  lightStart: d.u32, lightCount: d.u32,
  panelStart: d.u32, panelCount: d.u32,
  fscale: d.f32, polish: d.f32,
  benchX: d.f32, doorW: d.f32, doorE: d.f32, panelI: d.f32,
  panelColor: d.vec3f, layer: d.u32,
  bounce: d.vec3f, pad: d.f32,
});

export const MAX_ROOMS = 12;
export const MAX_GROUPS = 4;

/* the painting instances: one per panel (diptychs = two); style = the frame style (themes.ts) */
export const PaintingInst = d.struct({
  center: d.vec3f, hw: d.f32,
  right: d.vec3f, hh: d.f32,
  normal: d.vec3f, room: d.u32,
  style: d.u32, outer: d.f32, depth: d.f32, lowLayer: d.u32,
});

/* merged static mesh */
export const ArchVertex = d.unstruct({
  pos: d.float32x3, nrm: d.float32x3, uv: d.float32x2, col: d.unorm8x4, info: d.uint32,
});
export const archLayout = tgpu.vertexLayout(d.disarrayOf(ArchVertex));

/* the framed-canvas template mesh, expanded per instance (and frame style) in the vertex shader */
export const FrameVertex = d.unstruct({
  corner: d.float32x2, side: d.float32x2, seg: d.uint32x2, part: d.uint32,
});
export const frameLayout = tgpu.vertexLayout(d.disarrayOf(FrameVertex));
