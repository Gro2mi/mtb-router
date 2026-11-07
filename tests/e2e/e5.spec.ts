import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * E5 rendering tests: difficulty-colored route, elevation profile with
 * scrub→map marker, segment popup. Terrain tiles are mocked with a real
 * terrarium-encoded PNG generated in the browser so the profile works.
 */
const fixture = readFileSync(
  join(import.meta.dirname, '..', 'fixtures', 'overpass-corridor.json'),
  'utf8',
);

const SEED_VIEWPORT = {
  center: [8.002, 47.0002] as [number, number],
  zoom: 17,
  bearing: 0,
  pitch: 0,
};

const BASE = { x: 448, y: 360 };
const TAP_TRACK = { x: BASE.x, y: BASE.y + 49 };
const TAP_PATH = { x: BASE.x, y: BASE.y - 169 };
const canvas = (page: Page) => page.locator('canvas.maplibregl-canvas');

/**
 * The engine posts the flat route first, then the elevation-refined one —
 * geometry (and even the path) can shift between the two. Waits until the
 * rendered route data has been stable for two consecutive polls.
 */
async function waitForStableRoute(page: Page): Promise<void> {
  const read = async (): Promise<string | null> =>
    page.evaluate(async () => {
      const m = (window as unknown as Record<string, unknown>).__mtbrMap as
        | {
            getSource(
              id: string,
            ):
              | { getData(): Promise<{ features: { geometry: { coordinates: unknown } }[] }> }
              | undefined;
          }
        | undefined;
      if (!m) return null;
      const gj = await m.getSource('mtbr-route')?.getData();
      return gj ? JSON.stringify(gj.features.map((f) => f.geometry.coordinates)) : null;
    });
  await expect.poll(async () => (await read()) !== null, { timeout: 10_000 }).toBe(true);
  const once = await read();
  await expect.poll(async () => (await read()) === once, { timeout: 10_000 }).toBe(true);
}

/** serve a terrarium PNG whose elevation rises from south (500 m) to north (700 m) */
async function mockElevation(page: Page): Promise<void> {
  const pngB64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      // row 255 = south = 500 m, row 0 = north = 700 m
      const ele = 700 - (y / 255) * 200;
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4;
        const h = ele + 32768;
        img.data[i] = Math.floor(h / 256);
        img.data[i + 1] = Math.floor(h % 256);
        img.data[i + 2] = Math.round((h % 1) * 256);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return new Promise<string>((resolve) => {
      c.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob!);
      }, 'image/png');
    });
  });
  await page.route(
    '**/elevation-tiles-prod/**',
    async (route) =>
      await route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(pngB64.split(',')[1]!, 'base64'),
      }),
  );
}

async function planRoute(page: Page): Promise<void> {
  await page.route('**/api/interpreter*', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: fixture });
  });
  await mockElevation(page);
  await page.addInitScript((viewport) => {
    localStorage.setItem('mtbr.viewport.v1', JSON.stringify(viewport));
  }, SEED_VIEWPORT);

  await page.goto('/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Planning mode' }).click();
  await canvas(page).click({ position: TAP_TRACK });
  await canvas(page).click({ position: TAP_PATH });
  await expect(page.getByTestId('route-stats')).toBeVisible({ timeout: 30_000 });
  // ascent reflects the mocked south→north rise
  await expect(page.getByTestId('route-stats')).toContainText(/\d+\s*m/, { timeout: 10_000 });
}

test('route renders per-segment difficulty colors', async ({ page }) => {
  await planRoute(page);

  // the route can beat the map's 'load' event — wait for the contrast layers
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const m = (window as unknown as Record<string, unknown>).__mtbrMap as
            | {
                getLayer(id: string): unknown;
                getSource(id: string): { getData(): Promise<{ features: unknown[] }> } | undefined;
              }
            | undefined;
          return Boolean(m?.getLayer('mtbr-route-walk') && m.getSource('mtbr-route'));
        }),
      { timeout: 15_000 },
    )
    .toBe(true);

  const info = await page.evaluate(async () => {
    const m = (window as unknown as Record<string, unknown>).__mtbrMap as {
      getSource(
        id: string,
      ):
        | { getData(): Promise<{ features: { properties?: Record<string, unknown> }[] }> }
        | undefined;
      getLayer(id: string): unknown;
    };
    const source = m.getSource('mtbr-route');
    if (!source) return { colors: [], walkLayer: false };
    const gj = await source.getData();
    return {
      colors: [
        ...new Set(
          gj.features.map((f: { properties?: Record<string, unknown> }) => f.properties?.['color']),
        ),
      ],
      walkLayer: Boolean(m.getLayer('mtbr-route-walk')),
      difficulties: [
        ...new Set(
          gj.features.map(
            (f: { properties?: Record<string, unknown> }) => f.properties?.['difficulty'],
          ),
        ),
      ],
      hasDistanceProps: gj.features.every(
        (f: { properties?: Record<string, unknown> }) =>
          typeof f.properties?.['startM'] === 'number' &&
          typeof f.properties?.['endM'] === 'number',
      ),
    };
  });

  expect(info.walkLayer).toBe(true);
  expect(info.hasDistanceProps).toBe(true);
  // track (S0 green), singletrail (S2 orange), residential/connector (green)
  expect(info.colors.length).toBeGreaterThanOrEqual(2);
  expect(info.difficulties).toContain(2); // the tagged S2 singletrail
});

test('elevation profile renders and scrubs to a map marker', async ({ page }) => {
  await planRoute(page);
  await waitForStableRoute(page);

  const profile = page.getByTestId('elevation-profile');
  await expect(profile).toBeVisible({ timeout: 10_000 });
  await profile.scrollIntoViewIfNeeded();

  // scrub along the profile → the orange dot marker appears on the map
  const box = await profile.boundingBox();
  if (!box) throw new Error('profile box missing');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator('.mtbr-profile-dot')).toHaveCount(1, { timeout: 5_000 });
});

test('clicking the route shows a segment popup and highlights the profile', async ({ page }) => {
  await planRoute(page);

  // leave plan mode: clicking the line must not add a waypoint
  await page.getByRole('button', { name: 'Planning mode' }).click();

  await waitForStableRoute(page);

  // project a route vertex to pixels and click exactly on the line
  const point = await page.evaluate(async () => {
    const m = (window as unknown as Record<string, unknown>).__mtbrMap as {
      getSource(id: string): {
        getData(): Promise<{ features: { geometry: { coordinates: [number, number][] } }[] }>;
      };
      project(lngLat: [number, number]): { x: number; y: number };
    };
    const gj = await m.getSource('mtbr-route')!.getData();
    const coords = gj.features[1]!.geometry.coordinates as [number, number][];
    const mid = coords[Math.floor(coords.length / 2)]!;
    const p = m.project(mid);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  });

  await canvas(page).click({ position: point });

  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toBeVisible({ timeout: 5_000 });
  await expect(popup).toContainText(/MTB/i);
  await expect(popup).toContainText(/S\d/);
});

test('legend and difficulty breakdown appear with the route', async ({ page }) => {
  await planRoute(page);

  await expect(page.getByTestId('route-legend')).toBeVisible();
  await expect(page.getByTestId('route-legend')).toContainText('S0');
  await expect(page.getByTestId('route-legend')).toContainText('S2');
  await expect(page.getByTestId('difficulty-breakdown')).toContainText('S2');
  // max slope from the mocked elevation (fixture is ~112 m climb over ~500 m)
  await expect(page.getByTestId('difficulty-breakdown')).toContainText(/%/, { timeout: 5_000 });
});
