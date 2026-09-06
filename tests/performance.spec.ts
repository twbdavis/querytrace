import { expect, test } from '@playwright/test';

test('large results keep a bounded DOM and preserve row tracing across scroll windows', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE PERF_ROW (ID INTEGER PRIMARY KEY, LABEL TEXT);
    INSERT INTO PERF_ROW VALUES ${Array.from({ length: 500 }, (_, i) => `(${i + 1}, 'Row ${i + 1}')`).join(',')};
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await page.getByRole('tab').last().click();
  const result = page.getByRole('table', { name: 'Query results' });
  await expect(result).toHaveAttribute('aria-rowcount', '501');
  expect(await result.locator('[data-result-row]').count()).toBeLessThan(80);
  const scroll = page.locator('[data-result-scroll]');
  const beforeWidth = await result.boundingBox();
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const last = result.locator('[data-result-row="499"]');
  await expect(last).toBeVisible();
  await expect(last).toHaveAttribute('aria-rowindex', '501');
  await expect(last).toContainText('Row 500');
  await last.click();
  await expect(page.getByText(/tracing PERF_ROW · ID 500/)).toBeVisible();
  expect((await result.boundingBox())?.width).toBeCloseTo(beforeWidth!.width, 0);
  expect(await result.locator('[data-result-row]').count()).toBeLessThan(80);

  // Scrubbing must replace the old window and clear transient row indices.
  await page.getByRole('button', { name: 'Reset to first stage' }).click();
  await expect(result.locator('[data-result-row="0"]')).toBeVisible();
  await expect(page.getByText(/tracing PERF_ROW/)).toBeHidden();
});

test('join motion stops when paused and respects reduced motion', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  const editor = page.getByLabel('SQL query editor');
  await editor.fill('SELECT a.GIVEN_NAME FROM ASTRONOMER a JOIN OBSERVATION o ON a.ASTRONOMER_ID = o.ASTRONOMER_ID');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await expect(page.locator('.edge-pulse').first()).toBeAttached();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('.edge-pulse')).toHaveCount(0);
  await expect(page.locator('.bus-current')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const activeStage = await page.getByRole('tab', { selected: true }).getAttribute('aria-label');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.edge-pulse')).toHaveCount(0);
  await page.waitForTimeout(2200);
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('aria-label', activeStage!);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.edge-pulse').first()).toBeAttached();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.edge-pulse')).toHaveCount(0);
  const moving = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' && (animation.effect?.getComputedTiming().duration as number) > 1).length);
  expect(moving).toBe(0);
});
