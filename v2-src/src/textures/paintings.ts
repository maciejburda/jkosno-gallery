/* Painting textures — port of the v1 progressive loader (512 px queue + 1400 px near the visitor),
   reorganised for the GPU:
   - every photo gets a layer in one 256² thumbnail array (all mips) → one instanced draw for all canvases
   - nearby works stream into a small pool of hi-res slots and cross-fade in (no texture pop)
   Mip chains are produced by the browser's high-quality image resampler (createImageBitmap). */
import { tgpu, d, std, common, type TgpuRoot } from 'typegpu';
import { IMG_BASE } from '../shared/data.ts';

export interface PaintingInstanceRef { img: number; x: number; z: number }

const THUMB = 256;
const mipCount = (s: number) => Math.floor(Math.log2(s)) + 1;

async function decode(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return createImageBitmap(await res.blob());
}

export function createPaintingTextures(root: TgpuRoot, imgs: number[], opts: { hiSize: number; slots: number }) {
  const layerOf = new Map<number, number>();
  imgs.forEach((img, i) => layerOf.set(img, i));
  const N = Math.max(1, imgs.length);

  const thumbs = root.createTexture({ size: [THUMB, THUMB, N], format: 'rgba8unorm-srgb', mipLevelCount: mipCount(THUMB) })
    .$usage('sampled', 'render');
  const hi = root.createTexture({ size: [opts.hiSize, opts.hiSize, opts.slots], format: 'rgba8unorm-srgb', mipLevelCount: mipCount(opts.hiSize) })
    .$usage('sampled', 'render');
  const thumbsView = thumbs.createView(d.texture2dArray(d.f32));
  const hiView = hi.createView(d.texture2dArray(d.f32));

  /* mip chain of ONE layer on the GPU: bilinear 2×2 box downsample, level by level
     (the browser resamples only level 0 — far less main-thread work while walking) */
  const mipLayout = tgpu.bindGroupLayout({ src: { texture: d.texture2dArray(d.f32) } });
  const mipSampler = root.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const mipFrag = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((i) => {
    'use gpu';
    return std.textureSampleLevel(mipLayout.$.src, mipSampler.$, i.uv, 0, 0);
  });
  const mipPipe = root.createRenderPipeline({ vertex: common.fullScreenTriangle, fragment: mipFrag, targets: { format: 'rgba8unorm-srgb' } });

  function gpuMips(tex: typeof thumbs, layer: number, levels: number) {
    const enc = root['~unstable'].createCommandEncoder();
    for (let m = 0; m < levels - 1; m++) {
      const src = tex.createView(d.texture2dArray(d.f32), { baseMipLevel: m, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
      const dst = tex.createView('render', { baseMipLevel: m + 1, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: dst, loadOp: 'clear', storeOp: 'store' }] });
      mipPipe.with(root.createBindGroup(mipLayout, { src })).with(pass).draw(3);
      pass.end();
    }
    enc.submit();
  }

  async function writeChain(tex: typeof thumbs, bmp: ImageBitmap, size: number, layer: number) {
    const lvl = await createImageBitmap(bmp, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
    tex.write(lvl, { mipLevel: 0, origin: [0, 0, layer] });
    lvl.close();
    gpuMips(tex, layer, mipCount(size));
  }

  return {
    thumbsView, hiView, layerOf,

    /* small textures: progressive queue in the given order (lobby → end, like v1) */
    loadThumbs(order: number[], onLoaded: (img: number, done: number, total: number) => void) {
      const queue = [...new Set(order)].filter(i => layerOf.has(i));
      const total = queue.length;
      let done = 0, inFlight = 0;
      const pump = () => {
        while (inFlight < 4 && queue.length) {
          const img = queue.shift()!;
          inFlight++;
          decode(`${IMG_BASE}s/${img}.jpg`)
            .then(bmp => writeChain(thumbs, bmp, THUMB, layerOf.get(img)!).then(() => bmp.close()))
            .catch(err => console.warn('thumb', img, err))
            .finally(() => { inFlight--; done++; onLoaded(img, done, total); pump(); });
        }
      };
      pump();
    },

    async loadHi(img: number, slot: number) {
      const bmp = await decode(`${IMG_BASE}l/${img}.jpg`);
      await writeChain(hi as unknown as typeof thumbs, bmp, opts.hiSize, slot);
      bmp.close();
    },
  };
}
export type PaintingTextures = ReturnType<typeof createPaintingTextures>;

/* hi-res residency: the v1 rule (nearest ≤ HI_MAX within 10 m, drop beyond 16 m) on a slot pool */
export class HiResPool {
  private slotImg: (number | null)[];
  private imgSlot = new Map<number, number>();
  private loading = new Set<number>();
  /* per image: target mix (0/1) and current fade */
  readonly fade = new Map<number, number>();

  constructor(private tex: PaintingTextures, slots: number, private max: number) {
    this.slotImg = new Array(slots).fill(null);
  }

  slotOf(img: number): number { return this.imgSlot.get(img) ?? -1; }

  update(refs: PaintingInstanceRef[], cx: number, cz: number) {
    const dist = new Map<number, number>();
    for (const r of refs) {
      const dd = Math.hypot(r.x - cx, r.z - cz);
      dist.set(r.img, Math.min(dist.get(r.img) ?? 1e9, dd));
    }
    const want = [...dist.entries()].filter(([, dd]) => dd < 10).sort((a, b) => a[1] - b[1]).slice(0, this.max).map(([i]) => i);
    const wantSet = new Set(want);
    // release far ones
    for (const [img, slot] of [...this.imgSlot]) {
      if ((dist.get(img) ?? 1e9) > 16 && !this.loading.has(img)) {
        this.imgSlot.delete(img); this.slotImg[slot] = null; this.fade.delete(img);
      }
    }
    for (const img of want) {
      if (this.imgSlot.has(img) || this.loading.has(img)) continue;
      if (this.loading.size >= 2) break;   // spread decoding/uploads over several updates
      let slot = this.slotImg.indexOf(null);
      if (slot < 0) {
        // evict the farthest resident that is no longer wanted
        let worst = -1, wd = -1;
        this.slotImg.forEach((im, s) => {
          if (im === null || wantSet.has(im) || this.loading.has(im)) return;
          const dd = dist.get(im) ?? 1e9;
          if (dd > wd) { wd = dd; worst = s; }
        });
        if (worst < 0) continue;
        const old = this.slotImg[worst]!;
        this.imgSlot.delete(old); this.fade.delete(old);
        slot = worst;
      }
      this.slotImg[slot] = img;
      this.loading.add(img);
      this.tex.loadHi(img, slot)
        .then(() => { if (this.slotImg[slot] === img) { this.imgSlot.set(img, slot); this.fade.set(img, 0); } })
        .catch(err => { console.warn('hi', img, err); if (this.slotImg[slot] === img) this.slotImg[slot] = null; })
        .finally(() => this.loading.delete(img));
    }
  }

  /* advance cross-fades; returns true when anything changed */
  tick(dt: number): boolean {
    let changed = false;
    for (const [img, f] of this.fade) {
      if (f < 1) { this.fade.set(img, Math.min(1, f + dt / 0.45)); changed = true; }
    }
    return changed;
  }
}
