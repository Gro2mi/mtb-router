import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildTilesFromXml, tileToJson } from '../../scripts/build-tiles/build-tiles.mjs';

/**
 * E2 waypoint tests against a mocked Overpass API. The fixture places:
 *  - a compacted forest track along lat 47.0000
 *  - an S2 singletrail along lat 47.0010
 *  - a bicycle=no footway along lat 46.9990 (must be filtered out)
 *  - a residential road along lat 47.0020
 *
 * Map view is seeded via localStorage: center [8.002, 47.0002] @ zoom 17.
 * MapLibre uses 512 px vector tiles → ~0.41 m/px at zoom 17, so:
 *   track  ≈ 22 m south of the view center (54 px)
 *   path   ≈ 89 m north of the view center (218 px)
 *   footway≈ 133 m south of the view center (326 px)
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

/** map point safely left of the desktop drawer (x < 896) */
const BASE = { x: 448, y: 360 };
const TAP_TRACK = { x: BASE.x, y: BASE.y + 49 }; // ~20 m south of the track
const TAP_PATH = { x: BASE.x, y: BASE.y - 169 }; // ~20 m south of the singletrail
const TAP_NEAR_FOOTWAY = { x: BASE.x, y: BASE.y + 253 }; // ~30 m north of the excluded footway

/** elevation tiles are network-flaky in CI — abort them for fast degraded mode */
async function abortElevation(page: Page): Promise<void> {
  await page.route('**/elevation-tiles-prod/**', (route) => route.abort());
}

async function setupPage(page: Page): Promise<void> {
  let overpassRequests = 0;
  await page.route('**/api/interpreter*', async (route) => {
    overpassRequests++;
    await route.fulfill({ contentType: 'application/json', body: fixture });
  });
  await abortElevation(page);
  Object.defineProperty(page, 'overpassRequests', {
    get: () => overpassRequests,
    configurable: true,
  });
  await page.addInitScript((viewport) => {
    localStorage.setItem('mtbr.viewport.v1', JSON.stringify(viewport));
  }, SEED_VIEWPORT);
  await page.goto('/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  // the mocked corridor can beat the map style load — markers only exist once
  // the style (and thus the waypoint layer) is ready
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const m = (window as unknown as { __mtbrMap?: { isStyleLoaded(): boolean } }).__mtbrMap;
          return m?.isStyleLoaded() ?? false;
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

function requestCount(page: Page): number {
  return (page as Page & { overpassRequests?: number }).overpassRequests ?? 0;
}

const canvas = (page: Page) => page.locator('canvas.maplibregl-canvas');

test('plan mode: taps add waypoints that snap to the nearest way', async ({ page }) => {
  await setupPage(page);

  await page.getByRole('button', { name: 'Planning mode' }).click();

  await canvas(page).click({ position: TAP_TRACK });
  await expect(page.locator('.mtbr-waypoint[data-snapped="true"]')).toHaveCount(1, {
    timeout: 10_000,
  });

  await canvas(page).click({ position: TAP_PATH });
  await expect(page.locator('.mtbr-waypoint[data-snapped="true"]')).toHaveCount(2, {
    timeout: 10_000,
  });

  // roles: start + end
  await expect(page.locator('.mtbr-waypoint[data-role="start"]')).toHaveCount(1);
  await expect(page.locator('.mtbr-waypoint[data-role="end"]')).toHaveCount(1);

  // waypoint counter in the sheet reflects the list
  await expect(page.getByTestId('waypoint-count')).toContainText('Waypoints: 2');
});

test('footways with bicycle=no snap as walking edges (filter v2)', async ({ page }) => {
  await setupPage(page);
  await page.getByRole('button', { name: 'Planning mode' }).click();

  // ~30 m north of the footway — walking edges are snap targets since the
  // Nockspitze fix (displayed trails must be snappable)
  await canvas(page).click({ position: TAP_NEAR_FOOTWAY });
  await expect(page.locator('.mtbr-waypoint[data-snapped="true"]')).toHaveCount(1, {
    timeout: 10_000,
  });
});

test('identical re-plan issues no new Overpass requests (cache)', async ({ page }) => {
  test.setTimeout(60_000);
  await setupPage(page);
  await page.getByRole('button', { name: 'Planning mode' }).click();

  await canvas(page).click({ position: TAP_TRACK });
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(1, { timeout: 10_000 });
  await canvas(page).click({ position: TAP_PATH });
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(2, { timeout: 10_000 });

  // first undo/redo cycle: corridors may still be settling into the cache
  await page.keyboard.press('Control+z');
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(2);
  await page.waitForTimeout(1000);
  const settled = requestCount(page);

  // second cycle: both corridor keys are definitely cached now — the replans
  // must issue zero new Overpass requests
  await page.keyboard.press('Control+z');
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(2);
  await page.waitForTimeout(500);

  expect(requestCount(page)).toBe(settled);
});

test('undo/redo returns to any prior waypoint state', async ({ page }) => {
  await setupPage(page);
  await page.getByRole('button', { name: 'Planning mode' }).click();

  await canvas(page).click({ position: TAP_TRACK });
  await canvas(page).click({ position: { x: TAP_TRACK.x + 40, y: TAP_TRACK.y } });
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(2);

  await page.keyboard.press('Control+z');
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(0);

  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(2);
});

test('insert-via handle inserts a middle waypoint', async ({ page }) => {
  await setupPage(page);
  await page.getByRole('button', { name: 'Planning mode' }).click();

  await canvas(page).click({ position: TAP_TRACK });
  await canvas(page).click({ position: TAP_PATH });
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('.mtbr-insert')).toHaveCount(1);

  await page.locator('.mtbr-insert').click();
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(3, { timeout: 10_000 });
  await expect(page.locator('.mtbr-waypoint[data-role="via"]')).toHaveCount(1);
});

test('marker popup and right-click delete waypoints', async ({ page }) => {
  await setupPage(page);
  await page.getByRole('button', { name: 'Planning mode' }).click();

  await canvas(page).click({ position: TAP_TRACK });
  await canvas(page).click({ position: TAP_PATH });
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(2, { timeout: 10_000 });

  // touch-style: tap marker -> popup -> delete
  await page.locator('.mtbr-waypoint').first().click();
  await page.getByRole('button', { name: 'Delete waypoint' }).click();
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(1);

  // desktop: right-click the remaining marker deletes directly
  await page.locator('.mtbr-waypoint').first().click({ button: 'right' });
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(0);
});

test('route engine: two snapped waypoints produce a route with stats (E3)', async ({ page }) => {
  await setupPage(page);
  await page.getByRole('button', { name: 'Planning mode' }).click();

  // waypoint on the track + waypoint on the singletrail — the fixture's
  // connector way links both, so the engine must find a route
  await canvas(page).click({ position: TAP_TRACK });
  await expect(page.locator('.mtbr-waypoint[data-snapped="true"]')).toHaveCount(1, {
    timeout: 10_000,
  });
  await canvas(page).click({ position: TAP_PATH });
  await expect(page.locator('.mtbr-waypoint[data-snapped="true"]')).toHaveCount(2, {
    timeout: 10_000,
  });

  // the worker routes and reports stats into the drawer's Route tab
  await expect(page.getByTestId('route-stats')).toContainText(/km/i, { timeout: 30_000 });
  // no error pill
  await expect(page.getByTestId('route-error')).toHaveCount(0);
});

test('falls back to the main OSM API when all Overpass mirrors are unreachable', async ({
  page,
}) => {
  // simulate dead Overpass mirrors (instant network errors) and serve the
  // corridor through api.openstreetmap.org instead
  await page.route('**/api/interpreter*', (route) => route.abort());
  await abortElevation(page);
  const osmApiXml = readFileSync(
    join(import.meta.dirname, '..', 'fixtures', 'osm-api-map.xml'),
    'utf8',
  );
  let osmApiRequests = 0;
  await page.route('**/api.openstreetmap.org/api/0.6/map*', async (route) => {
    osmApiRequests++;
    await route.fulfill({ contentType: 'text/xml', body: osmApiXml });
  });
  await page.addInitScript((viewport) => {
    localStorage.setItem('mtbr.viewport.v1', JSON.stringify(viewport));
  }, SEED_VIEWPORT);

  await page.goto('/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Planning mode' }).click();

  await canvas(page).click({ position: TAP_TRACK });
  await expect(page.locator('.mtbr-waypoint[data-snapped="true"]')).toHaveCount(1, {
    timeout: 20_000,
  });
  expect(osmApiRequests).toBeGreaterThan(0);
});

test('self-hosted tiles serve the corridor without touching Overpass or the OSM API', async ({
  page,
}) => {
  // build tiles from the XML fixture with the real builder, serve them as a
  // fake static host, and count any escape attempts to public servers
  const fixtureXml = readFileSync(
    join(import.meta.dirname, '..', 'fixtures', 'osm-api-map.xml'),
    'utf8',
  );
  const { tiles } = await buildTilesFromXml(fixtureXml);

  let publicRequests = 0;
  await page.route('**/api/interpreter*', (route) => {
    publicRequests++;
    void route;
    return route.abort();
  });
  await page.route('**/api.openstreetmap.org/**', (route) => {
    publicRequests++;
    void route;
    return route.abort();
  });
  await abortElevation(page);
  await page.route('https://tiles.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/manifest.json')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ formatVersion: 2, tileDeg: 0.1, region: 'e2e' }),
      });
      return;
    }
    const key = url.pathname.split('/').pop()!.replace('.json', '');
    const tile = tiles.get(key);
    if (tile) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(tileToJson(tile)),
      });
    } else {
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });

  await page.addInitScript((viewport) => {
    localStorage.setItem('mtbr.viewport.v1', JSON.stringify(viewport));
    localStorage.setItem('mtbr.tileBaseUrl.v1', 'https://tiles.test');
  }, SEED_VIEWPORT);

  await page.goto('/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Planning mode' }).click();

  await canvas(page).click({ position: TAP_TRACK });
  await expect(page.locator('.mtbr-waypoint[data-snapped="true"]')).toHaveCount(1, {
    timeout: 10_000,
  });
  expect(publicRequests).toBe(0);
});

test.describe('mobile: long-press adds waypoints in browse mode', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('long-press adds a waypoint without plan mode', async ({ page }) => {
    await setupPage(page);
    // north of center: lands within the snap radius of the singletrail
    const x = 195;
    const y = 320;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.locator('.mtbr-waypoint')).toHaveCount(1, { timeout: 10_000 });
  });
});
