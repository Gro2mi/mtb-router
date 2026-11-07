import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

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

test('debug difficulty corridor', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().includes('[tiles]'))
      logs.push(`[${m.type()}] ${m.text().slice(0, 260)}`);
  });
  page.on('pageerror', (e) =>
    logs.push(
      '[pageerror] ' +
        e.message.slice(0, 260) +
        ' || ' +
        (e.stack ?? '').split('\n').slice(1, 3).join(' ~ '),
    ),
  );
  await page.route('**/api/interpreter*', async (r) => {
    logs.push('[interpreter] ' + String(r.request().postData() ?? '').slice(40, 90));
    await r.fulfill({ contentType: 'application/json', body: fixture });
  });
  await page.route('**/elevation-tiles-prod/**', (r) => r.abort());
  await page.route(/\/tiles\/(manifest\.json|t_[0-9]+_[0-9]+\.json)$/, async (r) => {
    logs.push('[tiles] ' + new URL(r.request().url()).pathname);
    await r.fulfill({ status: 404, body: 'nf' });
  });
  await page.addInitScript(
    (v) => localStorage.setItem('mtbr.viewport.v1', JSON.stringify(v)),
    SEED_VIEWPORT,
  );
  await page.goto('/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Planning mode' }).click();
  await page.locator('canvas.maplibregl-canvas').click({ position: TAP_TRACK });
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(1, { timeout: 10000 });
  await page.locator('canvas.maplibregl-canvas').click({ position: TAP_PATH });
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(2, { timeout: 10000 });
  await page.waitForTimeout(5000);
  console.log('LOGS:', logs.join(' ~ ') || '(none)');
  const snapped = await page
    .locator('.mtbr-waypoint')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-snapped')));
  console.log('SNAPPED:', JSON.stringify(snapped));
});
