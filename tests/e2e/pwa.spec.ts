import { expect, test } from '@playwright/test';

/**
 * E7.1 PWA acceptance: installable (manifest + icons + active service
 * worker) and the app shell boots offline.
 *
 * Service workers must be ALLOWED in this file — Playwright blocks them by
 * default — while all other spec files keep them blocked so request mocks
 * stay effective.
 */
test.use({ serviceWorkers: 'allow' });

test.describe(() => {
  test('manifest + icons + active service worker', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

    // manifest linked + parseable with icons
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) return null;
      return (await (await fetch(link.href)).json()) as { icons?: unknown[] };
    });
    expect(manifest).not.toBeNull();
    expect(manifest!.icons!.length).toBeGreaterThanOrEqual(3);

    // icon files actually served
    const iconOk = await page.evaluate(() => fetch('icons/icon-192.png').then((r) => r.ok));
    expect(iconOk).toBe(true);

    // service worker registered AND activated (activation may lag the load)
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg) return null;
            const active = reg.active ?? (await navigator.serviceWorker.ready).active;
            return active ? active.state : null;
          }),
        { timeout: 15_000 },
      )
      .toBe('activated');
  });

  test('app shell boots offline (airplane-mode reload)', async ({ page, context }) => {
    test.setTimeout(90_000);
    // load 1: SW installs and takes control — but this first load's assets
    // were fetched before control, so they are not yet runtime-cached
    await page.goto('/');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const reg = navigator.serviceWorker.controller;
            return reg ? 'controlled' : 'pending';
          }),
        { timeout: 15_000 },
      )
      .toBe('controlled');

    // load 2: a controlled page — every asset now flows through the runtime cache
    await page.reload();
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);

    // airplane mode: the shell (index + assets) must come from the SW caches
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'MTB Router' })).toBeVisible();
    await context.setOffline(false);
  });
});
