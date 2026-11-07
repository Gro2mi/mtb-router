import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * E4 difficulty preference tests: live reroute without corridor refetch,
 * hard-limit exclusions surfacing as a routing error, and preset recovery.
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

async function setupWithRoute(page: Page): Promise<number> {
  const dbg: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().includes('[tiles]')) dbg.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => dbg.push('[pageerror] ' + e.message.slice(0, 200)));
  let overpassRequests = 0;
  await page.route('**/api/interpreter*', async (route) => {
    overpassRequests++;
    await route.fulfill({ contentType: 'application/json', body: fixture });
  });
  await page.route('**/elevation-tiles-prod/**', (route) => route.abort());
  Object.defineProperty(page, 'overpassRequests', {
    get: () => overpassRequests,
    configurable: true,
  });
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
  await page.waitForTimeout(3000);
  console.log('DBG-early:', dbg.join(' ~ ') || '(none)');
  const alertText = await page.evaluate(
    () => document.querySelector('[role="alert"]')?.textContent ?? '(no alert)',
  );
  console.log('DBG-ALERT:', alertText);
  await expect(page.getByTestId('route-stats')).toBeVisible({ timeout: 30_000 });

  await page.waitForTimeout(2000);
  console.log('DBG:', dbg.join(' ~ ') || '(none)');
  const snapped = await page
    .locator('.mtbr-waypoint')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-snapped')));
  console.log('DBG-SNAPPED:', JSON.stringify(snapped));
  await page.getByRole('button', { name: 'Difficulty' }).click();
  await expect(page.getByTestId('difficulty-panel')).toBeVisible();
  return overpassRequests;
}

const requestCount = (page: Page): number =>
  (page as Page & { overpassRequests?: number }).overpassRequests ?? 0;

test('settings changes reroute live without refetching the corridor', async ({ page }) => {
  const baseline = await setupWithRoute(page);

  // uphill max 2 → 0: on the (flat) fixture nothing is excluded, the reroute
  // must succeed without any new Overpass request
  const uphillMax = page.getByRole('slider', { name: 'Uphill MTB scale · maximum' });
  await uphillMax.fill('0');
  await expect(uphillMax).toHaveValue('0');
  await page.waitForTimeout(800); // debounce 300 ms + worker reroute
  expect(requestCount(page)).toBe(baseline);
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await expect(page.getByTestId('route-stats')).toBeVisible();
  await expect(page.getByTestId('route-error')).toHaveCount(0);
  // waypoints untouched by the reroute
  await expect(page.locator('.mtbr-waypoint')).toHaveCount(2);
});

test('hard limit: excluding S2+ downhill blocks the route and surfaces the error', async ({
  page,
}) => {
  await setupWithRoute(page);

  // downhill MTB max 3 → 0: the S2 singletrail (waypoint 2 sits on it) is
  // excluded for through-travel → no route → widening → deterministic error
  const downhillMax = page.getByRole('slider', { name: 'Downhill MTB scale · maximum' });
  await downhillMax.fill('0');
  await expect(page.getByTestId('route-error')).toContainText('No route found', {
    timeout: 30_000,
  });
});

test('applying a preset recovers from a blocked route', async ({ page }) => {
  test.setTimeout(60_000);
  await setupWithRoute(page);

  await page.getByRole('slider', { name: 'Downhill MTB scale · maximum' }).fill('0');
  await expect(page.getByTestId('route-error')).toBeVisible({ timeout: 30_000 });

  // all-mountain preset restores the default bands → route returns
  await page.getByRole('button', { name: 'All-mountain' }).click();
  await expect(page.getByTestId('route-error')).toHaveCount(0, { timeout: 15_000 });
  // stats live on the Route tab; slider handles on the Difficulty tab
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await expect(page.getByTestId('route-stats')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Difficulty' }).click();
  // the preset also resets both handles
  await expect(page.getByRole('slider', { name: 'Downhill MTB scale · maximum' })).toHaveValue('3');
});

test('forest-road preference and untagged toggle re-route without refetch', async ({ page }) => {
  const baseline = await setupWithRoute(page);

  await page.getByRole('button', { name: 'High' }).click();
  await page.getByRole('checkbox', { name: 'Avoid untagged singletrail' }).check();
  await page.waitForTimeout(800);
  expect(requestCount(page)).toBe(baseline);
  await page.getByRole('button', { name: 'Route', exact: true }).click();
  await expect(page.getByTestId('route-stats')).toBeVisible();
  // all-mountain preset button is no longer pressed (custom state)
  await page.getByRole('button', { name: 'Difficulty' }).click();
  await expect(page.getByRole('button', { name: 'All-mountain' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('custom presets: save, apply, survive reload, delete', async ({ page }) => {
  await setupWithRoute(page);

  // tweak settings then save as a custom preset
  await page.getByRole('button', { name: 'High' }).click();
  await page.getByRole('button', { name: '+ Save current' }).click();
  await page.getByPlaceholder('Preset name…').fill('Gravel tour');
  await page.getByPlaceholder('Preset name…').press('Enter');
  await expect(page.getByRole('button', { name: 'Gravel tour', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gravel tour', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // switch away (enduro), then re-apply the custom preset
  await page.getByRole('button', { name: 'Enduro tech' }).click();
  await expect(page.getByRole('button', { name: 'Gravel tour', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Gravel tour', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Gravel tour', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // survives reload
  await page.reload();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Difficulty' }).click();
  await expect(page.getByRole('button', { name: 'Gravel tour', exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // delete
  await page.getByRole('button', { name: 'Delete preset Gravel tour' }).click();
  await expect(page.getByRole('button', { name: 'Gravel tour', exact: true })).toHaveCount(0);
});
