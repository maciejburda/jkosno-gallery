/* v2 entry: make sure WebGPU really works, otherwise hand the visitor to the classic (WebGL) gallery. */
import { tgpu } from 'typegpu';
import { getLang, makeT } from './shared/data.ts';
import { track } from './game/analytics.ts';

/* errors collected for automated checks (window.__errors) */
const errors: string[] = [];
(window as unknown as { __errors: string[] }).__errors = errors;
addEventListener('error', e => errors.push(String(e.message)));
addEventListener('unhandledrejection', e => errors.push(String(e.reason)));

const lang = getLang();
const T = makeT(lang);
const q = new URLSearchParams(location.search);

function fallback(reason: string) {
  track('webgpu_unsupported', { reason });
  const box = document.querySelector('#intro .ibox');
  if (box) {
    const p = document.createElement('p');
    p.id = 'gpuerr'; p.textContent = T('gpuError');
    box.appendChild(p);
  }
  setTimeout(() => location.replace('../3d.html' + location.search + location.hash), reason === 'forced' ? 300 : 2200);
}

async function boot() {
  if (q.get('nogpu') === '1') return fallback('forced');
  if (!('gpu' in navigator)) return fallback('no_navigator_gpu');
  let root;
  try {
    root = await tgpu.init({
      adapter: { powerPreference: 'high-performance' },
      device: { optionalFeatures: ['timestamp-query'] },
    });
  } catch (err) {
    console.warn(err);
    return fallback('no_adapter');
  }
  root.device.lost.then(info => {
    if (info.reason !== 'destroyed') fallback('device_lost');
  });
  root.device.addEventListener('uncapturederror', e => {
    const m = (e as GPUUncapturedErrorEvent).error.message;
    if (errors.length < 50) errors.push('[webgpu] ' + m);
    console.error('[webgpu]', m);
  });
  const { startApp } = await import('./app.ts');
  await startApp(root, lang);
}
boot().catch(err => { console.error(err); fallback('boot_error'); });
