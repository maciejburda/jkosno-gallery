import { defineConfig, type Plugin } from 'vite';
import typegpu from 'unplugin-typegpu/vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/* Dev only: the built page lives at /v2/ and fetches images from ../assets/img/,
   which the dev server (rooted in v2-src) maps onto the repo's assets/img folder.
   The v1 page (3d.html) is served too, so the WebGPU fallback can be followed. */
function serveRepoFiles(): Plugin {
  const types: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.html': 'text/html', '.js': 'text/javascript' };
  return {
    name: 'kosno-serve-repo-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        const ok = url.startsWith('/assets/') || url === '/3d.html';
        if (!ok) return next();
        const file = normalize(join(repoRoot, url));
        if (!file.startsWith(repoRoot) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [typegpu(), serveRepoFiles()],
  server: { fs: { allow: [repoRoot] } },
  build: {
    outDir: resolve(repoRoot, 'v2'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
