/* Every canvas-drawn label (plaques, room signs, lobby title, biography, rug, captions)
   packed into a few 2048² atlas pages → one texture array, one draw for all of them.
   Drawing code is ported from v1 (textTexture / bio panel / rug). */
import type { T } from '../shared/data.ts';

export const PAGE = 2048;
export interface AtlasRect { page: number; u0: number; v0: number; u1: number; v1: number }

interface Pending { w: number; h: number; draw: (g: CanvasRenderingContext2D, w: number, h: number) => void; out: AtlasRect }

export class LabelAtlas {
  private pending: Pending[] = [];
  pages: HTMLCanvasElement[] = [];

  add(w: number, h: number, draw: Pending['draw']): AtlasRect {
    const out: AtlasRect = { page: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
    this.pending.push({ w, h, draw, out });
    return out;
  }

  /* shelf packing, tallest first; 2px gutters against bleeding between labels */
  pack() {
    const items = [...this.pending].sort((a, b) => b.h - a.h);
    const G = 4;
    let page = -1, x = 0, y = 0, shelfH = 0;
    let g: CanvasRenderingContext2D | null = null;
    const newPage = () => {
      const c = document.createElement('canvas'); c.width = c.height = PAGE;
      this.pages.push(c); g = c.getContext('2d')!; page++; x = 0; y = 0; shelfH = 0;
    };
    newPage();
    for (const it of items) {
      if (x + it.w > PAGE) { x = 0; y += shelfH + G; shelfH = 0; }
      if (y + it.h > PAGE) newPage();
      const ctx = g!;
      ctx.save(); ctx.translate(x, y);
      ctx.beginPath(); ctx.rect(0, 0, it.w, it.h); ctx.clip();
      it.draw(ctx, it.w, it.h);
      ctx.restore();
      Object.assign(it.out, { page, u0: (x + 0.5) / PAGE, v0: (y + 0.5) / PAGE, u1: (x + it.w - 0.5) / PAGE, v1: (y + it.h - 0.5) / PAGE });
      x += it.w + G; shelfH = Math.max(shelfH, it.h);
    }
    this.pending = [];
  }
}

export interface Line { text: string; font: string; ink?: string; dy?: number }
export interface TextOpts { bg?: string | null; border?: boolean; bar?: string; ink?: string; dot?: boolean }

/* v1 textTexture(), drawn at an arbitrary scale into the atlas */
export function drawText(lines: Line[], refW: number, refH: number, opts: TextOpts = {}) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.scale(w / refW, h / refH);
    const W = refW, H = refH;
    if (opts.bg !== null) { g.fillStyle = opts.bg || '#f2ede0'; g.fillRect(0, 0, W, H); }
    if (opts.border) { g.strokeStyle = 'rgba(60,45,30,.35)'; g.lineWidth = 6; g.strokeRect(6, 6, W - 12, H - 12); }
    if (opts.bar) { g.fillStyle = opts.bar; g.fillRect(W * 0.36, H - 24, W * 0.28, 9); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((L, i) => {
      g.font = L.font;
      g.fillStyle = L.ink || opts.ink || '#3a2e22';
      g.fillText(L.text, W / 2, H * (i + 1) / (n + 1) + (L.dy || 0));
    });
    if (opts.dot) { g.fillStyle = '#c0392b'; g.beginPath(); g.arc(W - 38, 40, 16, 0, 7); g.fill(); }
  };
}

function wrapText(g: CanvasRenderingContext2D, txt: string, x: number, y: number, maxW: number, lh: number) {
  let line = '';
  for (const w of txt.split(' ')) {
    const t2 = line ? line + ' ' + w : w;
    if (g.measureText(t2).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; }
    else line = t2;
  }
  if (line) { g.fillText(line, x, y); y += lh; }
  return y;
}

export function drawBio(T: T, n: number) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.scale(w / 1024, h / 1000);
    g.fillStyle = '#f4efe3'; g.fillRect(0, 0, 1024, 1000);
    g.strokeStyle = 'rgba(70,54,38,.35)'; g.lineWidth = 4; g.strokeRect(14, 14, 996, 972);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#8a7a66'; g.font = '600 30px system-ui';
    g.fillText(T('aboutPainter'), 62, 86);
    g.fillStyle = '#2f2519'; g.font = '500 84px Georgia';
    g.fillText('Jan Kosno', 58, 174);
    g.fillStyle = '#6f5f4c'; g.font = '400 40px Georgia';
    g.fillText('1913 – 1996', 60, 228);
    g.fillStyle = '#b08d4f'; g.fillRect(60, 256, 210, 7);
    g.fillStyle = '#3a2f22'; g.font = '400 33px system-ui';
    let yy = 320;
    for (const par of [T('bioPanel1'), T('bioPanel2'), T('bioPanel3'), T('bioPanel4', { n })]) yy = wrapText(g, par, 60, yy, 900, 46) + 24;
  };
}

export function drawRug(g: CanvasRenderingContext2D, w: number, h: number) {
  g.scale(w / 768, h / 512);
  g.fillStyle = '#5e2f2c'; g.fillRect(0, 0, 768, 512);
  g.strokeStyle = '#b08d4f'; g.lineWidth = 10; g.strokeRect(30, 30, 708, 452);
  g.strokeStyle = 'rgba(216,201,168,.8)'; g.lineWidth = 3; g.strokeRect(52, 52, 664, 408);
  g.save(); g.beginPath(); g.rect(60, 60, 648, 392); g.clip();
  g.strokeStyle = 'rgba(232,214,180,.07)'; g.lineWidth = 2;
  for (let d = -512; d < 768 + 512; d += 44) {
    g.beginPath(); g.moveTo(d, 0); g.lineTo(d + 512, 512); g.stroke();
    g.beginPath(); g.moveTo(d + 512, 0); g.lineTo(d, 512); g.stroke();
  }
  g.restore();
}
