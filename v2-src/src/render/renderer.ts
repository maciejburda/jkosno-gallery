/* The v2 frame graph (TypeGPU):
     1. planar floor reflection — the whole museum mirrored in y, half/quarter resolution, mipmapped
     2. main HDR pass (rgba16float, 4× MSAA): merged architecture (1 draw) + all paintings (1 instanced draw)
        + optional extra scene draws (the forest)
     3. bloom (downsample/upsample chain) → composite: PBR-Neutral tonemap, vignette, grain → canvas
   Lighting: hemisphere ambient, the ceiling panels as soft area lights, one picture light per work with
   an analytic soft frame shadow, analytic room AO (the rooms are boxes), GGX specular. */
import { tgpu, d, std, common, type TgpuRoot } from 'typegpu';
import { perlin2d, randf } from '@typegpu/noise';
import { mat4 } from 'wgpu-matrix';
import { Frame, Light, RoomInfo, PaintingInst, archLayout, frameLayout } from './schemas.ts';
import { srgbToLinear, linearToSrgb, tonemapNeutral, ggxSpec, fresnel, sdBox, luminance } from './gpuMath.ts';
import { bakeFloors } from './floorBake.ts';
import type { World } from '../world/build.ts';
import { Part, buildFrameMesh } from '../world/frameMesh.ts';
import { Mat } from '../world/mesh.ts';
import { WALL_H, ROOM_W, DOOR_W, DOOR_H } from '../world/layout.ts';
import { floorRecipes } from '../world/styles.ts';
import type { PaintingTextures } from '../textures/paintings.ts';
import { PAGE } from '../textures/labels.ts';

export type Tier = 'high' | 'low';

export interface InstanceRec {
  center: [number, number, number]; right: [number, number, number]; normal: [number, number, number];
  hw: number; hh: number; room: number; frameCol: [number, number, number]; img: number; layer: number;
}

export interface ViewState {
  pos: [number, number, number]; yaw: number; pitch: number;
  time: number;
  groups: Float32Array;          // 4 × mat4 (static, plug, blue key, orange key)
  fog: { color: [number, number, number]; near: number; far: number };
  ambient: [number, number, number];
  exposure: number;
  inForest: boolean;
}

/* extra draws recorded into the main / reflection passes (the forest plugs in here) */
export type PassLike = ReturnType<ReturnType<TgpuRoot['~unstable']['createCommandEncoder']>['beginRenderPass']>;

const HDR = 'rgba16float' as const;
const DEPTH = 'depth32float' as const;
const PIC_LIGHT = d.vec3f(1.0, 0.93, 0.83);       // warm track lights
const PLACEHOLDER = d.vec3f(0.6, 0.56, 0.46);      // canvas tone before the photo arrives (#cfc6b5)
const GOLD = d.vec3f(0.95, 0.72, 0.36);
const PANEL_EMIT = 4.5;

export function createRenderer(root: TgpuRoot, canvas: HTMLCanvasElement, world: World, opts: {
  tier: Tier; tex: PaintingTextures; instances: InstanceRec[];
}) {
  const HIGH = opts.tier === 'high';
  const context = root.configureContext({ canvas, alphaMode: 'opaque' });
  const presentFormat = navigator.gpu.getPreferredCanvasFormat();

  /* ---------------- static resources ---------------- */
  const archBuf = root.createBuffer(archLayout.schemaForCount(world.vertexCount)).$usage('vertex');
  archBuf.write(world.mesh);
  const frameMesh = buildFrameMesh();
  const frameBuf = root.createBuffer(frameLayout.schemaForCount(frameMesh.count)).$usage('vertex');
  frameBuf.write(frameMesh.bytes);

  const NL = Math.max(1, world.lights.length);
  const lights = root.createReadonly(d.arrayOf(Light, NL), world.lights.map(l => ({
    pos: d.vec3f(...l.pos), intensity: l.intensity, dir: d.vec3f(...l.dir), cosIn: l.cosIn,
    center: d.vec3f(...l.center), cosOut: l.cosOut, normal: d.vec3f(...l.normal), depth: l.depth,
    right: d.vec3f(...l.right), minD2: l.minD2, half: d.vec2f(...l.half), pad1: d.vec2f(),
  })));
  const NR = world.rooms.length;
  const rooms = root.createReadonly(d.arrayOf(RoomInfo, NR), world.rooms.map(r => ({
    x0: r.x0, x1: r.x1, lightStart: r.lightStart, lightCount: r.lightCount, panelStart: r.panelStart, panelCount: r.panelCount,
    fscale: r.fscale, polish: r.polish, benchX: r.benchX, doorW: r.doorW, doorE: r.doorE, panelI: r.panelI,
    panelColor: d.vec3f(...r.panelColor), layer: r.layer, bounce: d.vec3f(...r.bounce), pad: 0,
  })));
  const panels = root.createReadonly(d.arrayOf(d.vec4f, Math.max(1, world.panels.length)), world.panels.map(p => d.vec4f(...p)));

  const NI = Math.max(1, opts.instances.length);
  const insts = root.createReadonly(d.arrayOf(PaintingInst, NI), opts.instances.map(i => ({
    center: d.vec3f(...i.center), hw: i.hw, right: d.vec3f(...i.right), hh: i.hh,
    normal: d.vec3f(...i.normal), room: i.room, frameCol: d.vec3f(...i.frameCol), lowLayer: i.layer,
  })));
  /* per instance: (hi slot, hi mix, thumb ready, unused) — rewritten when streaming changes */
  const dynData = new Float32Array(NI * 4);
  const dyn = root.createReadonly(d.arrayOf(d.vec4f, NI));

  const groups = root.createUniform(d.arrayOf(d.mat4x4f, 4));
  const frameMain = root.createUniform(Frame);
  const frameRefl = root.createUniform(Frame);
  const frameAcc = tgpu.accessor(Frame);
  const reflSlot = tgpu.slot(false);

  const floors = bakeFloors(root, floorRecipes, HIGH ? 1024 : 512);

  const atlasTex = root.createTexture({ size: [PAGE, PAGE, world.atlas.pages.length], format: 'rgba8unorm-srgb', mipLevelCount: 12 })
    .$usage('sampled', 'render');
  atlasTex.write(world.atlas.pages);
  atlasTex.generateMipmaps();
  const atlas = atlasTex.createView(d.texture2dArray(d.f32));

  const aniso = HIGH ? 16 : 8;
  const sRepeat = root.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: aniso });
  const sClamp = root.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', maxAnisotropy: aniso });
  const sPost = root.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

  const reflLayout = tgpu.bindGroupLayout({ refl: { texture: d.texture2d(d.f32) } });
  const srcLayout = tgpu.bindGroupLayout({ src: { texture: d.texture2d(d.f32) } });
  const compLayout = tgpu.bindGroupLayout({ scene: { texture: d.texture2d(d.f32) }, bloom: { texture: d.texture2d(d.f32) } });
  const PostU = d.struct({ exposure: d.f32, bloom: d.f32, time: d.f32, vignette: d.f32, sharpen: d.f32, pad: d.vec3f });
  const post = root.createUniform(PostU);

  /* ---------------- lighting ---------------- */
  const LightSum = d.struct({ diff: d.vec3f, spec: d.vec3f, occl: d.f32 });

  const lightAt = (P: d.v3f, N: d.v3f, V: d.v3f, room: number, rough: number) => {
    'use gpu';
    const R = rooms.$[room];
    let diff = d.vec3f(0);
    let spec = d.vec3f(0);
    let occl = d.f32(1);
    // ceiling panels: closest point on the 2.6 × 1.1 m panel = soft area light
    const pEnd = R.panelStart + R.panelCount;
    for (let i = R.panelStart; i < pEnd; i++) {
      const pc = panels.$[i];
      const q = d.vec3f(std.clamp(P.x, pc.x - 1.3, pc.x + 1.3), pc.y, std.clamp(P.z, pc.z - 0.55, pc.z + 0.55));
      const Lv = q - P;
      const dist2 = std.dot(Lv, Lv);
      const L = Lv * std.inverseSqrt(std.max(dist2, 0.0001));
      const emit = std.max(L.y, 0);
      const e = R.panelColor * (R.panelI * 5.2 * emit / (dist2 + 0.9));
      diff += e * std.max(std.dot(N, L), 0);
      spec += e * ggxSpec(N, V, L, std.max(rough, 0.3));
    }
    // picture lights (+ the soft shadow each frame casts onto its wall)
    const lEnd = R.lightStart + R.lightCount;
    for (let i = R.lightStart; i < lEnd; i++) {
      const lt = lights.$[i];
      const Lv = lt.pos - P;
      const dist2 = std.dot(Lv, Lv);
      const L = Lv * std.inverseSqrt(dist2);
      const spot = std.smoothstep(lt.cosOut, lt.cosIn, std.dot(L * -1, lt.dir));
      if (spot > 0.0005) {
        const toP = P - lt.center;
        const dn = std.dot(toP, lt.normal);
        let sh = d.f32(1);
        if (dn < 0.004 && dn > -0.06) {
          const wp = d.vec2f(std.dot(toP, lt.right), toP.y);
          // contact occlusion right around the frame
          occl = occl * (1 - 0.32 * std.exp(-std.max(sdBox(wp, lt.half), 0) / 0.035));
          const ln = std.max(std.dot(L, lt.normal), 0.05);
          const t = (lt.depth - dn) / ln;
          const H = toP + L * t;
          const sd = sdBox(d.vec2f(std.dot(H, lt.right), H.y), lt.half);
          const pen = 0.006 + t * 0.045;
          sh = std.smoothstep(-pen, pen, sd);
        }
        const e = PIC_LIGHT * (lt.intensity / std.max(dist2, lt.minD2) * spot * sh);
        diff += e * std.max(std.dot(N, L), 0);
        spec += e * ggxSpec(N, V, L, rough);
      }
    }
    return LightSum({ diff, spec, occl });
  };

  const aoTerm = tgpu.fn([d.f32, d.f32, d.f32], d.f32)((dist, k, r) => {
    'use gpu';
    if (dist < 0.012) { return d.f32(1); }
    return 1 - k * std.exp(-dist / r);
  });

  /* rooms are boxes → ambient occlusion from the distances to their six planes */
  const roomAO = (P: d.v3f, room: number) => {
    'use gpu';
    const R = rooms.$[room];
    let ao = aoTerm(P.y, 0.42, 0.32) * aoTerm(WALL_H - P.y, 0.3, 0.4) * aoTerm(ROOM_W / 2 - std.abs(P.z), 0.34, 0.42);
    const inDoor = std.abs(P.z) < DOOR_W / 2 && P.y < DOOR_H;
    if (!(inDoor && R.doorW > 0.5)) { ao = ao * aoTerm(P.x - R.x0, 0.34, 0.42); }
    if (!(inDoor && R.doorE > 0.5)) { ao = ao * aoTerm(R.x1 - P.x, 0.34, 0.42); }
    if (R.benchX > -100 && P.y < 0.03) {
      const sd = sdBox(d.vec2f(P.x - R.benchX, P.z), d.vec2f(1.1, 0.3));
      ao = ao * (1 - 0.55 * std.exp(-std.max(sd, 0) / 0.16));
    }
    return ao;
  };

  const finish = (colIn: d.v3f, P: d.v3f) => {
    'use gpu';
    const F = frameAcc.$;
    const dist = std.length(F.camPos - P);
    const fog = std.clamp((dist - F.fogNear) / (F.fogFar - F.fogNear), 0, 1);
    return std.mix(colIn, F.fogColor, fog);
  };

  /* ---------------- architecture ---------------- */
  const archVert = tgpu.vertexFn({
    in: { pos: d.vec3f, nrm: d.vec3f, uv: d.vec2f, col: d.vec4f, info: d.u32 },
    out: { position: d.builtin.position, wpos: d.vec3f, wnrm: d.vec3f, uv: d.vec2f, col: d.vec4f, info: d.interpolate('flat', d.u32) },
  })((i) => {
    'use gpu';
    const M = groups.$[(i.info >> 16) & 255];
    const wp = (M * d.vec4f(i.pos, 1)).xyz;
    const wn = (M * d.vec4f(i.nrm, 0)).xyz;
    return { position: frameAcc.$.viewProj * d.vec4f(wp, 1), wpos: wp, wnrm: wn, uv: i.uv, col: i.col, info: i.info };
  });

  const archFrag = tgpu.fragmentFn({
    in: { position: d.builtin.position, wpos: d.vec3f, wnrm: d.vec3f, uv: d.vec2f, col: d.vec4f, info: d.interpolate('flat', d.u32) },
    out: d.vec4f,
  })((i) => {
    'use gpu';
    const mat = i.info & 255;
    const room = (i.info >> 8) & 255;
    const layer = (i.info >> 24) & 255;
    const R = rooms.$[room];
    const F = frameAcc.$;
    const P = i.wpos;
    if (reflSlot.$) {
      if (P.y < -0.01) { std.discard(); }
    }
    const V = std.normalize(F.camPos - P);
    let N = std.normalize(i.wnrm);
    // derivatives in uniform control flow, used by the gradient samplers below
    const fuv = P.xz / R.fscale;
    const fdx = std.dpdx(fuv);
    const fdy = std.dpdy(fuv);
    const adx = std.dpdx(i.uv);
    const ady = std.dpdy(i.uv);

    let albedo = srgbToLinear(i.col.xyz);
    let rough = i.col.w;
    let specW = d.f32(0.5);
    let metal = d.f32(0);
    let emissive = d.vec3f(0);
    let alpha = d.f32(1);
    let ao = roomAO(P, room);
    let reflK = d.f32(0);
    let reflCol = d.vec3f(0);

    if (mat === Mat.Plaster) {
      const ax = std.abs(N.x) > 0.5;
      const w2 = std.select(d.vec2f(P.x, P.y), d.vec2f(P.z, P.y), ax);
      albedo = albedo * (0.965 + perlin2d.sample(w2 * 2.7) * 0.045 + perlin2d.sample(w2 * 19 + 7.1) * 0.02);
      if (HIGH) {
        const gb = perlin2d.sampleWithGradient(w2 * 90);
        const T = std.select(d.vec3f(1, 0, 0), d.vec3f(0, 0, 1), ax);
        N = std.normalize(N - (T * gb.y + d.vec3f(0, 1, 0) * gb.z) * 0.03);
      }
      rough = 0.85;
      specW = 0.2;
    } else if (mat === Mat.Floor) {
      const a = std.textureSampleGrad(floors.albedo.$, sRepeat.$, fuv, layer, fdx, fdy);
      const dt = std.textureSampleGrad(floors.detail.$, sRepeat.$, fuv, layer, fdx, fdy);
      const macro = perlin2d.sample(P.xz * 0.31) * 0.08 + perlin2d.sample(P.xz * 1.37 + 3.3) * 0.04;
      albedo = srgbToLinear(a.xyz) * (1 + macro);
      rough = std.clamp(a.w + macro * 0.4, 0.05, 1);
      const tn = dt.xy * 2 - 1;
      N = std.normalize(d.vec3f(tn.x, 1, tn.y));
      ao = ao * dt.z;
      specW = 0.6;
      if (!reflSlot.$) {
        const suv = i.position.xy / F.viewport + N.xz * 0.025;
        reflCol = std.textureSampleLevel(reflLayout.$.refl, sPost.$, suv, rough * 5).xyz;
        const ndv = std.max(std.dot(N, V), 0);
        reflK = std.clamp((0.07 + 0.93 * fresnel(0, ndv)) * R.polish * dt.w * (1 - rough * 0.65) * 1.6, 0, 0.92);
      }
    } else if (mat === Mat.Wood) {
      albedo = albedo * (0.92 + perlin2d.sample(d.vec2f((P.x + P.z) * 2.5, P.y * 60)) * 0.08);
      specW = 0.7;
    } else if (mat === Mat.Emissive) {
      emissive = albedo * (PANEL_EMIT * i.col.w);
      albedo = d.vec3f(0);
    } else if (mat === Mat.Label) {
      const t = std.textureSampleGrad(atlas.$, sClamp.$, i.uv, layer, adx, ady);
      albedo = d.vec3f(t.xyz);
      alpha = t.w;
      rough = 0.75;
      specW = 0.25;
      if (reflSlot.$) {
        if (alpha < 0.5) { std.discard(); }
      }
    } else if (mat === Mat.Fabric) {
      albedo = albedo * (0.9 + perlin2d.sample(P.xz * 400) * 0.1);
      rough = 0.95;
      specW = 0.15;
    } else if (mat === Mat.Key) {
      metal = 1;
      rough = 0.28;
      emissive = albedo * (0.9 + 0.5 * std.sin(F.time * 3.2));
    }

    const LS = lightAt(P, N, V, room, rough);
    const hemi = std.mix(R.bounce * 0.95, F.ambient, N.y * 0.5 + 0.5);
    const diffuse = albedo * (LS.diff + hemi * ao * LS.occl) * (1 - metal);
    const f0c = std.mix(d.vec3f(0.04), albedo, metal);
    const specular = f0c * LS.spec * specW + albedo * metal * hemi * ao * 0.35;
    let col = diffuse + specular + emissive;
    col = std.mix(col, reflCol, reflK);
    return d.vec4f(finish(col, P), alpha);
  });

  /* ---------------- paintings (one instanced draw) ---------------- */
  const paintVert = tgpu.vertexFn({
    in: { corner: d.vec2f, side: d.vec2f, prof: d.vec2f, pnrm: d.vec2f, part: d.u32, iid: d.builtin.instanceIndex },
    out: { position: d.builtin.position, wpos: d.vec3f, wnrm: d.vec3f, uv: d.vec2f, part: d.interpolate('flat', d.u32), iid: d.interpolate('flat', d.u32) },
  })((i) => {
    'use gpu';
    const inst = insts.$[i.iid];
    const up = d.vec3f(0, 1, 0);
    const lx = i.corner.x * (inst.hw + i.prof.x);
    const ly = i.corner.y * (inst.hh + i.prof.x);
    const wp = inst.center + inst.right * lx + up * ly + inst.normal * i.prof.y;
    const sideW = inst.right * i.side.x + up * i.side.y;
    const wn = sideW * i.pnrm.x + inst.normal * i.pnrm.y;
    const uv = d.vec2f(i.corner.x * 0.5 + 0.5, 0.5 - i.corner.y * 0.5);
    return { position: frameAcc.$.viewProj * d.vec4f(wp, 1), wpos: wp, wnrm: wn, uv, part: i.part, iid: i.iid };
  });

  const paintFrag = tgpu.fragmentFn({
    in: { position: d.builtin.position, wpos: d.vec3f, wnrm: d.vec3f, uv: d.vec2f, part: d.interpolate('flat', d.u32), iid: d.interpolate('flat', d.u32) },
    out: d.vec4f,
  })((i) => {
    'use gpu';
    const inst = insts.$[i.iid];
    const dy = dyn.$[i.iid];
    const F = frameAcc.$;
    const P = i.wpos;
    const V = std.normalize(F.camPos - P);
    let N = std.normalize(i.wnrm);
    const adx = std.dpdx(i.uv);
    const ady = std.dpdy(i.uv);
    const mpp = std.fwidth(i.uv.x) * inst.hw * 2;    // metres per pixel on the canvas
    const lo = std.textureSampleGrad(opts.tex.thumbsView.$, sClamp.$, i.uv, inst.lowLayer, adx, ady).xyz;
    const hi = std.textureSampleGrad(opts.tex.hiView.$, sClamp.$, i.uv, d.u32(std.max(dy.x, 0)), adx, ady).xyz;

    let albedo = d.vec3f(0);
    let rough = d.f32(0.45);
    let specW = d.f32(0.8);
    let metal = d.f32(0);
    let lip = d.f32(1);
    if (i.part === Part.Canvas) {
      let c = std.mix(std.mix(PLACEHOLDER, lo, dy.z), hi, dy.y);
      // the v1 ART_FILTER, now on the GPU: saturate(1.14) contrast(1.02)
      const l = luminance(c);
      c = std.max(std.mix(d.vec3f(l), c, 1.14), d.vec3f(0));
      c = std.max((c - 0.18) * 1.02 + 0.18, d.vec3f(0));
      albedo = d.vec3f(c);
      rough = 0.32;
      specW = 0.3;
      if (HIGH) {
        // canvas weave: ~1.1 mm threads, faded out as soon as a pixel covers a thread
        const m = i.uv * d.vec2f(inst.hw, inst.hh) * (2 / 0.0011) * Math.PI * 2;
        const fade = 1 - std.smoothstep(0.00035, 0.0011, mpp);
        const wv = d.vec2f(std.cos(m.x), std.cos(m.y)) * (0.1 * fade);
        N = std.normalize(N + inst.right * wv.x + d.vec3f(0, wv.y, 0));
      }
      // the moulding's top lip shades a band along the top edge of the canvas
      const dTop = (i.uv.y) * inst.hh * 2;
      lip = std.mix(0.45, 1, std.smoothstep(0.012, 0.04, dTop));
    } else if (i.part === Part.Wood) {
      albedo = srgbToLinear(inst.frameCol) * (0.9 + perlin2d.sample(d.vec2f(std.dot(P, inst.right) * 3, P.y * 3) * 9) * 0.1);
      rough = 0.42;
      specW = 0.9;
    } else {
      albedo = d.vec3f(GOLD);
      metal = 1;
      rough = 0.3;
    }

    const LS = lightAt(P, N, V, inst.room, rough);
    const R = rooms.$[inst.room];
    const hemi = std.mix(R.bounce * 0.95, F.ambient, N.y * 0.5 + 0.5);
    const diffuse = albedo * (LS.diff * lip + hemi * 0.95) * (1 - metal);
    const f0c = std.mix(d.vec3f(0.04), albedo, metal);
    const specular = f0c * LS.spec * specW * lip + albedo * metal * hemi * 0.45;
    return d.vec4f(finish(diffuse + specular, P), 1);
  });

  /* ---------------- pipelines ---------------- */
  const depthMain = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' } as const;
  const mkScene = (refl: boolean) => {
    const cfg = root.with(frameAcc, refl ? frameRefl : frameMain).with(reflSlot, refl);
    const primitive = { cullMode: 'back', frontFace: refl ? 'cw' : 'ccw' } as const;
    const multisample = refl ? { count: 1 } : { count: 4, alphaToCoverageEnabled: true };
    return {
      arch: cfg.createRenderPipeline({
        attribs: archLayout.attrib, vertex: archVert, fragment: archFrag,
        targets: { format: HDR }, primitive, depthStencil: depthMain, multisample,
      }),
      paint: cfg.createRenderPipeline({
        attribs: frameLayout.attrib, vertex: paintVert, fragment: paintFrag,
        targets: { format: HDR }, primitive, depthStencil: depthMain, multisample: refl ? { count: 1 } : { count: 4 },
      }),
    };
  };
  const main = mkScene(false);
  const refl = mkScene(true);

  /* ---------------- post ---------------- */
  const prefilterSlot = tgpu.slot(false);
  const downFrag = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((i) => {
    'use gpu';
    const ts = 1 / d.vec2f(std.textureDimensions(srcLayout.$.src));
    let c = std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv, 0).xyz * 4;
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(-1, -1), 0).xyz;
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(1, -1), 0).xyz;
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(-1, 1), 0).xyz;
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(1, 1), 0).xyz;
    c = c / 8;
    if (prefilterSlot.$) {
      const br = std.max(c.x, std.max(c.y, c.z));
      const soft = std.clamp(br - 0.9, 0, 1.2);
      const contrib = std.max(soft * soft / 4.8, br - 2.1) / std.max(br, 0.0001);
      c = std.min(c * std.max(contrib, 0), d.vec3f(40));
    }
    return d.vec4f(c, 1);
  });
  const upFrag = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((i) => {
    'use gpu';
    const ts = 1 / d.vec2f(std.textureDimensions(srcLayout.$.src));
    let c = d.vec3f(0);
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(-1, 0), 0).xyz * 2;
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(1, 0), 0).xyz * 2;
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(0, -1), 0).xyz * 2;
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(0, 1), 0).xyz * 2;
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(-1, -1), 0).xyz;
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(1, -1), 0).xyz;
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(-1, 1), 0).xyz;
    c += std.textureSampleLevel(srcLayout.$.src, sPost.$, i.uv + ts * d.vec2f(1, 1), 0).xyz;
    return d.vec4f(c / 12, 1);
  });
  const compFrag = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((i) => {
    'use gpu';
    const P = post.$;
    let c = std.textureSampleLevel(compLayout.$.scene, sPost.$, i.uv, 0).xyz;
    if (P.sharpen > 0) {
      // light unsharp mask when rendering below native resolution
      const ts = 1 / d.vec2f(std.textureDimensions(compLayout.$.scene));
      const nb = (std.textureSampleLevel(compLayout.$.scene, sPost.$, i.uv + d.vec2f(ts.x, 0), 0).xyz
        + std.textureSampleLevel(compLayout.$.scene, sPost.$, i.uv - d.vec2f(ts.x, 0), 0).xyz
        + std.textureSampleLevel(compLayout.$.scene, sPost.$, i.uv + d.vec2f(0, ts.y), 0).xyz
        + std.textureSampleLevel(compLayout.$.scene, sPost.$, i.uv - d.vec2f(0, ts.y), 0).xyz) * 0.25;
      c = std.max(c + (c - nb) * P.sharpen, d.vec3f(0));
    }
    const b = std.textureSampleLevel(compLayout.$.bloom, sPost.$, i.uv, 0).xyz;
    c = tonemapNeutral(c * P.exposure + b * P.bloom);
    const q = i.uv - 0.5;
    c = c * (1 - std.dot(q, q) * P.vignette);
    let s = linearToSrgb(std.clamp(c, d.vec3f(0), d.vec3f(1)));
    randf.seed3(d.vec3f(i.uv * 1731, P.time));
    s = s + (randf.sample() - 0.5) * (1.6 / 255);
    return d.vec4f(s, 1);
  });

  const fs = common.fullScreenTriangle;
  const downPrefilter = root.with(prefilterSlot, true).createRenderPipeline({ vertex: fs, fragment: downFrag, targets: { format: HDR } });
  const downPlain = root.createRenderPipeline({ vertex: fs, fragment: downFrag, targets: { format: HDR } });
  const upAdd = root.createRenderPipeline({
    vertex: fs, fragment: upFrag,
    targets: { format: HDR, blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } } },
  });
  const composite = root.createRenderPipeline({ vertex: fs, fragment: compFrag, targets: { format: presentFormat } });

  /* ---------------- resolution-dependent targets ---------------- */
  const BLOOM_LEVELS = HIGH ? 5 : 4;
  type Targets = ReturnType<typeof makeTargets>;
  function makeTargets(w: number, h: number) {
    const msaa = root.createTexture({ size: [w, h], format: HDR, sampleCount: 4 }).$usage('render');
    const depth = root.createTexture({ size: [w, h], format: DEPTH, sampleCount: 4 }).$usage('render');
    const scene = root.createTexture({ size: [w, h], format: HDR }).$usage('render', 'sampled');
    const rs = HIGH ? 0.5 : 0.35;
    const rw = Math.max(16, Math.round(w * rs)), rh = Math.max(16, Math.round(h * rs));
    const reflMips = 5;
    const reflTex = root.createTexture({ size: [rw, rh], format: HDR, mipLevelCount: reflMips }).$usage('render', 'sampled');
    const reflDepth = root.createTexture({ size: [rw, rh], format: DEPTH }).$usage('render');
    const reflRT = reflTex.createView('render', { baseMipLevel: 0, mipLevelCount: 1 });
    const reflBG = root.createBindGroup(reflLayout, { refl: reflTex.createView(d.texture2d(d.f32)) });
    let bw = w, bh = h;
    const blooms = Array.from({ length: BLOOM_LEVELS }, () => {
      bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
      const tex = root.createTexture({ size: [bw, bh], format: HDR }).$usage('render', 'sampled');
      const view = tex.createView(d.texture2d(d.f32));
      return { tex, rt: tex.createView('render'), view, bg: root.createBindGroup(srcLayout, { src: view }) };
    });
    const sceneView = scene.createView(d.texture2d(d.f32));
    const sceneSrcBG = root.createBindGroup(srcLayout, { src: sceneView });
    const compBG = root.createBindGroup(compLayout, { scene: sceneView, bloom: blooms[0].view });
    return { w, h, msaa, depth, scene, reflTex, reflDepth, reflRT, reflBG, blooms, sceneSrcBG, compBG,
      destroy() { msaa.destroy(); depth.destroy(); scene.destroy(); reflTex.destroy(); reflDepth.destroy(); blooms.forEach(b => b.tex.destroy()); } };
  }

  let targets: Targets | null = null;
  let renderScale = 1;
  const maxDpr = HIGH ? 2 : 1.5;
  function ensureTargets() {
    const dpr = Math.min(devicePixelRatio || 1, maxDpr);
    const cw = Math.max(1, Math.round(innerWidth * dpr)), ch = Math.max(1, Math.round(innerHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const w = Math.max(16, Math.round(cw * renderScale)), h = Math.max(16, Math.round(ch * renderScale));
    if (!targets || targets.w !== w || targets.h !== h) { targets?.destroy(); targets = makeTargets(w, h); }
    return targets;
  }

  /* ---------------- per-frame ---------------- */
  const proj = mat4.create(), view = mat4.create(), vp = mat4.create(), mirror = mat4.scaling([1, -1, 1]), tmp = mat4.create();
  let extra: ((pass: PassLike, refl: boolean) => void) | null = null;

  function writeFrame(buf: typeof frameMain, vs: ViewState, t: Targets, m: Float32Array, camY: number) {
    buf.write({
      viewProj: m, camPos: d.vec3f(vs.pos[0], camY, vs.pos[2]), time: vs.time,
      fogColor: d.vec3f(...vs.fog.color), fogNear: vs.fog.near,
      viewport: d.vec2f(t.w, t.h), fogFar: vs.fog.far, exposure: vs.exposure,
      ambient: d.vec3f(...vs.ambient), inForest: vs.inForest ? 1 : 0,
    });
  }

  function render(vs: ViewState) {
    const t = ensureTargets();
    const aspect = t.w / t.h;
    mat4.perspectiveReverseZ(68 * Math.PI / 180, aspect, 0.15, Infinity, proj);
    mat4.identity(tmp);
    mat4.translate(tmp, vs.pos, tmp);
    mat4.rotateY(tmp, vs.yaw, tmp);
    mat4.rotateX(tmp, vs.pitch, tmp);
    mat4.invert(tmp, view);
    mat4.multiply(proj, view, vp);
    writeFrame(frameMain, vs, t, vp as Float32Array, vs.pos[1]);
    const doRefl = !vs.inForest;
    if (doRefl) {
      mat4.multiply(vp, mirror, tmp);
      writeFrame(frameRefl, vs, t, tmp as Float32Array, -vs.pos[1]);
    }
    groups.write(vs.groups);
    post.write({ exposure: vs.exposure, bloom: vs.inForest ? 0.09 : 0.055, time: vs.time % 1000, vignette: 0.42, sharpen: renderScale < 0.99 ? 0.35 : 0, pad: d.vec3f() });

    const clear = [vs.fog.color[0], vs.fog.color[1], vs.fog.color[2], 1] as const;
    const enc = root['~unstable'].createCommandEncoder();
    if (doRefl) {
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view: t.reflRT, loadOp: 'clear', storeOp: 'store', clearValue: clear }],
        depthStencilAttachment: { view: t.reflDepth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      refl.arch.with(archLayout, archBuf).with(rp).draw(world.vertexCount);
      refl.paint.with(frameLayout, frameBuf).with(rp).draw(frameMesh.count, opts.instances.length);
      extra?.(rp, true);
      rp.end();
      enc.submit();
      t.reflTex.generateMipmaps();
    } else {
      enc.submit();
    }

    const enc2 = root['~unstable'].createCommandEncoder();
    const mp = enc2.beginRenderPass({
      colorAttachments: [{ view: t.msaa, resolveTarget: t.scene, loadOp: 'clear', storeOp: 'discard', clearValue: clear }],
      depthStencilAttachment: { view: t.depth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    });
    if (!vs.inForest) {
      main.arch.with(archLayout, archBuf).with(t.reflBG).with(mp).draw(world.vertexCount);
      main.paint.with(frameLayout, frameBuf).with(mp).draw(frameMesh.count, opts.instances.length);
    }
    extra?.(mp, false);
    mp.end();

    // bloom chain
    for (let k = 0; k < t.blooms.length; k++) {
      const p = enc2.beginRenderPass({ colorAttachments: [{ view: t.blooms[k].rt, loadOp: 'clear', storeOp: 'store' }] });
      (k === 0 ? downPrefilter : downPlain).with(k === 0 ? t.sceneSrcBG : t.blooms[k - 1].bg).with(p).draw(3);
      p.end();
    }
    for (let k = t.blooms.length - 1; k > 0; k--) {
      const p = enc2.beginRenderPass({ colorAttachments: [{ view: t.blooms[k - 1].rt, loadOp: 'load', storeOp: 'store' }] });
      upAdd.with(t.blooms[k].bg).with(p).draw(3);
      p.end();
    }
    const cp = enc2.beginRenderPass({ colorAttachments: [{ view: context, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    composite.with(t.compBG).with(cp).draw(3);
    cp.end();
    enc2.submit();
  }

  return {
    render,
    root, frameAcc, reflSlot, frameMain, frameRefl, lightAt, finish, sClamp, sRepeat,
    setExtension(fn: typeof extra) { extra = fn; },
    get renderScale() { return renderScale; },
    set renderScale(s: number) { renderScale = s; },
    get size() { return targets ? [targets.w, targets.h] : [0, 0]; },
    /* streaming state → GPU */
    setDyn(i: number, hiSlot: number, hiMix: number, thumbReady: number) {
      dynData[i * 4] = hiSlot; dynData[i * 4 + 1] = hiMix; dynData[i * 4 + 2] = thumbReady;
    },
    flushDyn() { dyn.write(dynData); },
    async warmup() {
      await Promise.all([main.arch, main.paint, refl.arch, refl.paint, downPrefilter, downPlain, upAdd, composite].map(p => p.initAsync()));
    },
    shaderCode() { return tgpu.resolve([main.arch, main.paint, composite]); },
  };
}
export type Renderer = ReturnType<typeof createRenderer>;
