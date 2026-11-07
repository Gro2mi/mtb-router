import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * E5.1/E2 deploy verification: the built app must boot when served from a
 * SUBFOLDER (mydomain.com/mtb-router/) — relative asset base, page-relative
 * worker URL, and tile auto-discovery all resolve against the page URL.
 */
const DIST = resolve(join(import.meta.dirname, '..', '..', 'dist'));
const FOLDER = '/mtb-router';
const PORT = 4175;

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function startSubfolderServer(): Promise<Server> {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      // serve /mtb-router and /mtb-router/ as the app entry (Apache does the
      // redirect automatically; mirror it so the page URL carries the slash)
      if (pathname === FOLDER) {
        res.writeHead(301, { Location: `${FOLDER}/` });
        res.end();
        return;
      }
      const rel = pathname.startsWith(`${FOLDER}/`) ? pathname.slice(FOLDER.length + 1) : pathname;
      let file = resolve(join(DIST, normalize(rel).replace(/^([/\\])+/, '')));
      if (!file.startsWith(DIST)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!existsSync(file) || statSync(file).isDirectory()) {
        // SPA fallback (vite preview behaves the same way)
        file = join(DIST, 'index.html');
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    server.listen(PORT, '127.0.0.1', () => resolveServer(server));
  });
}

test('app boots from a subfolder deploy (mydomain.com/mtb-router/)', async ({ page }) => {
  const server = await startSubfolderServer();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));

  await page.goto(`http://127.0.0.1:${PORT}${FOLDER}/`);

  // the app shell boots: map canvas + attribution (style + worker working)
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap', {
    timeout: 20_000,
  });
  // tile auto-discovery probes the subfolder (the deployed tiles/ folder) and
  // the domain root — both 404 here, so the corridor pill must reflect reality
  // instead of hanging
  await expect(page.getByRole('button', { name: 'Planning mode' })).toBeVisible();

  expect(errors).toEqual([]);

  await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
});
