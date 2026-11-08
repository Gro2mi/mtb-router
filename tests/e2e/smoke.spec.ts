import { expect, test } from '@playwright/test';

test('app loads with a working map (sized container, worker, style)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  // The map container must have real height: maplibre's CSS forces
  // `position: relative` on it, which collapses it to 0 if its geometry
  // depends on Tailwind's `absolute inset-0` (Tailwind v4 cascade layers).
  await expect
    .poll(async () => page.getByTestId('map').evaluate((el) => el.clientHeight))
    .toBeGreaterThan(100);
  // The attribution control only receives source attributions once the style
  // has loaded — a dead worker leaves the canvas blank, so this catches that.
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap', {
    timeout: 20_000,
  });

  // outdoor contrast pass: dedicated high-visibility track/cycleway layers
  // (they are added in the map's 'load' handler — poll for them)
  await expect
    .poll(
      async () => {
        const contrast = await page.evaluate(() => {
          const map = (window as unknown as { __mtbrMap?: { getLayer(id: string): unknown } })
            .__mtbrMap;
          return {
            track: map ? Boolean(map.getLayer('mtbr-track')) : false,
            cycleway: map ? Boolean(map.getLayer('mtbr-cycleway')) : false,
          };
        });
        return contrast.track && contrast.cycleway;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});

test('language switches to German and survives reload (via settings page)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Difficulty' })).toBeVisible();

  // language lives on the settings page (gear button in the sheet header)
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'DE', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Difficulty' })).toBeHidden();

  await page.reload();
  // German persisted through the reload
  await expect(page.getByRole('button', { name: 'Schwierigkeit' })).toBeVisible();
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
});

test('north button resets a rotated map', async ({ page }) => {
  await page.addInitScript(
    (viewport) => {
      localStorage.setItem('mtbr.viewport.v1', JSON.stringify(viewport));
    },
    { center: [10.2, 49.9], zoom: 12, bearing: 45, pitch: 0 },
  );

  await page.goto('/');
  const north = page.getByRole('button', { name: 'North the map' });
  await expect(north).toBeVisible({ timeout: 15_000 });
  await expect(north).toHaveAttribute('aria-pressed', 'false');

  await north.click();
  await expect(north).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
});

test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('collapsed stats bar shows and the sheet expands via the handle', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('stats-row')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Difficulty' })).toBeHidden();

    await page.getByRole('button', { name: 'Show panel' }).click();

    await expect(page.getByRole('button', { name: 'Difficulty' })).toBeVisible();
  });

  test('contour toggle on the settings page persists across reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('stats-row')).toBeVisible();

    // default on; open Settings → toggle off
    await page.getByTestId('stat-distance').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    const toggle = page.getByTestId('contours-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    // survives reload (settings page needs reopening — sheet collapsed again)
    await page.reload();
    await expect(page.getByTestId('stats-row')).toBeVisible();
    await page.getByTestId('stat-distance').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByTestId('contours-toggle')).not.toBeChecked();
  });

  test('any tap on the collapsed sheet opens it; plan button clears the open sheet', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('stats-row')).toBeVisible();

    // tap the stats bar itself (not the handle) → sheet opens
    await page.getByTestId('stat-distance').click();
    await expect(page.getByRole('button', { name: 'Difficulty' })).toBeVisible();

    // collapse again via the handle → the plan-mode FAB is back above the bar
    await page.getByRole('button', { name: 'Hide panel' }).click();
    await expect(page.getByRole('button', { name: 'Difficulty' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Planning mode' })).toBeVisible();
  });
});

const PHOTON_BODY = {
  features: [
    {
      geometry: { coordinates: [11.35, 47.26] },
      properties: { name: 'Natters', city: 'Natters', country: 'Österreich' },
    },
    {
      geometry: { coordinates: [11.39, 47.28] },
      properties: { name: 'Nockspitze', state: 'Tirol', country: 'Österreich' },
    },
  ],
};

function mockGeocoders(context: import('@playwright/test').BrowserContext): void {
  context.route('**/photon.komoot.io/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(PHOTON_BODY) }),
  );
}

test('place search: results dropdown, flyTo + pin on pick', async ({ page, context }) => {
  mockGeocoders(context);
  await page.goto('/');
  await expect(page.getByTestId('search-input')).toBeVisible();

  await page.getByTestId('search-input').fill('nock');
  await expect(page.getByTestId('search-result')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.getByTestId('search-result').first()).toContainText('Natters');

  // keyboard: arrow down + enter picks the highlighted row
  await page.getByTestId('search-input').press('ArrowDown');
  await page.getByTestId('search-input').press('Enter');

  // the camera flew to the picked place (flyTo animates ~1.4 s) and the pin is on the map
  await expect
    .poll(async () => {
      const center = await page.evaluate(() => {
        const map = (window as unknown as {
          __mtbrMap?: { getCenter(): { lng: number; lat: number } };
        }).__mtbrMap;
        const c = map!.getCenter();
        return { lng: c.lng.toFixed(2), lat: c.lat.toFixed(2) };
      });
      return center;
    }, { timeout: 10_000 })
    .toEqual({ lng: '11.39', lat: '47.28' });
  await expect(page.locator('.mtbr-search-pin')).toBeVisible();

  // a map tap clears the pin (search lifecycle ends on next map action)
  await page.evaluate(() => localStorage.removeItem('mtbr.viewport.v1'));
  await page.locator('canvas.maplibregl-canvas').click({ position: { x: 200, y: 400 } });
  await expect(page.locator('.mtbr-search-pin')).toHaveCount(0);
});

test('place search falls back to Nominatim when Photon is unreachable', async ({
  page,
  context,
}) => {
  let nominatimHits = 0;
  await context.route('**/photon.komoot.io/**', (route) => route.abort());
  await context.route('**/nominatim.openstreetmap.org/**', (route) => {
    nominatimHits++;
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ lon: '11.35', lat: '47.26', display_name: 'Natters, Tirol' }]),
    });
  });
  await page.goto('/');
  await expect(page.getByTestId('search-input')).toBeVisible();

  await page.getByTestId('search-input').fill('natters');
  await expect(page.getByTestId('search-result')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('search-result')).toContainText('Natters, Tirol');
  expect(nominatimHits).toBe(1);
});
