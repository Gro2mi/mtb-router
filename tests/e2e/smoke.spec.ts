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
});

test('language switches to German and survives reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Difficulty' })).toBeVisible();

  await page.getByRole('button', { name: 'DE', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Schwierigkeit' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Difficulty' })).toBeHidden();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Schwierigkeit' })).toBeVisible();
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
});
