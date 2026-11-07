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

test('debug two taps', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      logs.push(`[${m.type()}] ${m.text().slice(0, 220)}`);
  });
  page.on('pageerror', (e) =>
    logs.push('[pageerror] ' + e.message.slice(0, 220) + ' || ' + (e.stack ?? '').split('\n')[1]),
  );
  await page.route('**/api/interpreter*', async (r) => {
    logs.push('[interpreter] called');
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
  await page.locator('canvas.maplibregl-canvas').click({ position: { x: BASE.x, y: BASE.y + 49 } });
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(1, { timeout: 10000 });
  console.log('W1 ok');
  await page
    .locator('canvas.maplibregl-canvas')
    .click({ position: { x: BASE.x, y: BASE.y - 169 } });
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(2, { timeout: 10000 });
  console.log('W2 ok');
  await page.waitForTimeout(4000);
  console.log('LOGS:', logs.join(' ~ ') || '(none)');
});
