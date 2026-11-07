import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * E6 route persistence tests: save → reload → load round-trip, GPX export
 * download, rename/delete. Overpass mocked like the waypoint suite.
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

async function planRoute(page: Page): Promise<void> {
  await page.route('**/api/interpreter*', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: fixture });
  });
  await page.route('**/elevation-tiles-prod/**', (route) => route.abort());
  await page.addInitScript((viewport) => {
    localStorage.setItem('mtbr.viewport.v1', JSON.stringify(viewport));
  }, SEED_VIEWPORT);

  // hermetic: no tiles folder on this origin — the public chain is expected
  await page.route(/[/]tiles[/](manifest[.]json|t_[0-9]+_[0-9]+[.]json)$/, (route) =>
    route.fulfill({ status: 404, body: 'not built' }),
  );
  await page.goto('/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Planning mode' }).click();
  await canvas(page).click({ position: TAP_TRACK });
  await canvas(page).click({ position: TAP_PATH });
  await expect(page.getByTestId('route-stats')).toBeVisible({ timeout: 30_000 });
}

async function openRoutesTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Routes' }).click();
  await expect(page.getByTestId('routes-panel')).toBeVisible();
}

test('save → reload → load restores the route with stats', async ({ page }) => {
  await planRoute(page);
  await openRoutesTab(page);

  await page.getByTestId('route-name-input').fill('Nockspitze Abendrunde');
  await page.getByTestId('route-save').click();
  await expect(page.getByTestId('routes-list')).toBeVisible({ timeout: 10_000 });

  // full reload — everything in-memory is gone, IDB persists
  await page.reload();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await openRoutesTab(page);
  await expect(page.getByTestId('routes-list')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('route-load-Nockspitze Abendrunde').click();
  // restored route shows stats again (seeded from the record, then replanned)
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await expect(page.getByTestId('route-stats')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('route-error')).toHaveCount(0);
  // restored waypoints are on the map, snapped
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(2);
});

test('GPX export downloads a schema-valid file', async ({ page }) => {
  await planRoute(page);
  await openRoutesTab(page);

  await page.getByTestId('route-name-input').fill('Export Test');
  await page.getByTestId('route-save').click();
  await expect(page.getByTestId('routes-list')).toBeVisible({ timeout: 10_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('route-gpx-Export Test').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('export-test.gpx');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const gpx = Buffer.concat(chunks).toString('utf8');
  expect(gpx).toContain('<gpx version="1.1"');
  expect(gpx).toContain('creator="MTB Router"');
  expect(gpx).toContain('<trkpt');
  expect(gpx).toContain('<wpt');
  expect(gpx.trimEnd().endsWith('</gpx>')).toBe(true);
});

test('rename and delete work from the list', async ({ page }) => {
  await planRoute(page);
  await openRoutesTab(page);

  await page.getByTestId('route-name-input').fill('Original');
  await page.getByTestId('route-save').click();
  await expect(page.getByTestId('routes-list')).toBeVisible({ timeout: 10_000 });

  // rename — the edit input is the only textbox inside the routes list
  await page.getByRole('button', { name: 'Rename' }).first().click();
  await page.getByTestId('routes-list').locator('input').fill('Umbenannt');
  await page.getByRole('button', { name: '✓' }).first().click();
  await expect(page.getByTestId('routes-list')).toContainText('Umbenannt');

  // delete
  await page.getByTestId('route-delete-Umbenannt').click();
  await expect(page.getByTestId('routes-empty')).toBeVisible({ timeout: 10_000 });
});
