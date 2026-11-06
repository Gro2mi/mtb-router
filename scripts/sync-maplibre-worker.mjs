/**
 * Copies the MapLibre GL worker bundle into public/vendor/ so it is served at a
 * stable URL in dev and shipped with production builds.
 *
 * maplibre-gl v6 resolves its worker via `new URL('./maplibre-gl-worker.mjs',
 * import.meta.url)`, which neither Vite's dev-server pre-bundling (the worker is
 * not copied into node_modules/.vite/deps) nor the production bundler (the
 * filename is computed at runtime) can handle. We point `setWorkerUrl()` at
 * this copy instead — see src/lib/map/createMap.ts.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl-worker.mjs');
const destDir = join(root, 'public', 'vendor');
const dest = join(destDir, 'maplibre-gl-worker.mjs');

mkdirSync(destDir, { recursive: true });
copyFileSync(source, dest);
console.log('copied maplibre-gl worker to public/vendor/maplibre-gl-worker.mjs');
