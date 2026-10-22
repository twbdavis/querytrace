import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __querytraceDraws: number;
    __querytraceRenderFailure: boolean;
  }
}

async function requireWebGL(page: Page) {
  const supported = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  });
  test.skip(!supported, 'This browser environment does not provide WebGL2.');
}

async function trackDraws(page: Page) {
  await page.addInitScript(() => {
    window.__querytraceDraws = 0;
    window.__querytraceRenderFailure = false;
    const prototype = WebGL2RenderingContext.prototype;
    const drawElements = prototype.drawElements;
    prototype.drawElements = function (...args: Parameters<typeof drawElements>) {
      if (window.__querytraceRenderFailure) throw new Error('Injected scene rendering failure');
      window.__querytraceDraws++;
      return drawElements.apply(this, args);
    };
    const drawArrays = prototype.drawArrays;
    prototype.drawArrays = function (...args: Parameters<typeof drawArrays>) {
      if (window.__querytraceRenderFailure) throw new Error('Injected scene rendering failure');
      window.__querytraceDraws++;
      return drawArrays.apply(this, args);
    };
  });
}

const drawCount = (page: Page) => page.evaluate(() => window.__querytraceDraws);

async function expectDrawsStopped(page: Page) {
  // Allow a queued observer/resize callback to settle before measuring a pause.
  await page.waitForTimeout(100);
  const before = await drawCount(page);
  await page.waitForTimeout(300);
  expect(await drawCount(page)).toBe(before);
}

function watchOldScreenshotRequests(page: Page) {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('hero-join')) requests.push(request.url());
  });
  return requests;
}

async function expectStaticJoin(page: Page, screenshotRequests: string[]) {
  await expect(page.locator('[data-mode]')).toHaveAttribute('data-mode', 'fallback');
  const fallback = page.getByTestId('hero-static-join');
  await expect(fallback).toBeVisible();
  await expect(fallback.locator('img, image, canvas')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /All six screenings match a venue/ })).toBeVisible();
  await expect(page.locator('.queryExecHighlight')).toContainText('SELECT');
  const diagram = fallback.locator('svg:visible');
  await expect(diagram).toHaveCount(1);
  await expect(diagram.locator('[data-table]')).toHaveCount(3);
  await expect(diagram.locator('[data-table="SCREENING"]')).toContainText('VENUE_ID');
  await expect(diagram.locator('[data-table="VENUE"]')).toContainText('VENUE_ID');
  await expect(diagram.locator('[data-table="RESULT"] [data-row]')).toHaveText([
    'Beacon TheaterPaper MoonsFriday',
    'Foundry HallThe Last PollinatorFriday',
    'Orchard CinemaSignal from the AtticSaturday',
    'Riverside ScreenKite CitySaturday',
    'Maple MicrocinemaSecond BreakfastSunday',
    'Beacon TheaterTide AtlasSaturday',
  ]);
  expect(screenshotRequests).toEqual([]);
}

test('landing animation renders, pauses, resumes and follows motion preferences', async ({ page }) => {
  await requireWebGL(page);
  await trackDraws(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const scene = page.locator('[data-mode]');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-mode', 'live');
  await scene.scrollIntoViewIfNeeded();
  await expect(canvas).toHaveCSS('opacity', '1');
  const initial = await drawCount(page);
  await expect.poll(() => drawCount(page)).toBeGreaterThan(initial);

  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await expect(scene).toHaveAttribute('data-playback', 'paused');
  await expectDrawsStopped(page);
  const paused = await drawCount(page);
  await page.getByRole('button', { name: 'Resume animation', exact: true }).click();
  await expect.poll(() => drawCount(page)).toBeGreaterThan(paused);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(scene).toHaveAttribute('data-mode', 'still');
  await expect(canvas).toHaveCSS('opacity', '1');
  await expect(page.getByRole('button', { name: 'Pause animation', exact: true })).toHaveCount(0);
  await expectDrawsStopped(page);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(scene).toHaveAttribute('data-mode', 'live');
  await expect(canvas).toHaveCSS('opacity', '1');
  const restarted = await drawCount(page);
  await expect.poll(() => drawCount(page)).toBeGreaterThan(restarted);
});

test('a failed scene download keeps the landing page and tracer links usable', async ({ page }) => {
  await requireWebGL(page);
  const screenshotRequests = watchOldScreenshotRequests(page);
  let blocked = false;
  await page.route('**/_next/static/chunks/*.js', async (route) => {
    const response = await route.fetch();
    if ((await response.text()).includes('The join scene could not start.')) {
      blocked = true;
      await route.abort('failed');
    } else {
      await route.fulfill({ response });
    }
  });
  await page.goto('/');
  await expectStaticJoin(page, screenshotRequests);
  expect(blocked).toBe(true);
  await expect(page.getByRole('heading', { name: 'Watch a query run.' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Open the tracer' }).click();
  await expect(page).toHaveURL(/\/trace$/);
  await expect(page.getByLabel('SQL query editor')).toBeVisible();
});

test('a scene rendering failure falls back without replacing the homepage', async ({ page }) => {
  await requireWebGL(page);
  const screenshotRequests = watchOldScreenshotRequests(page);
  await trackDraws(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-mode]').scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Pause animation', exact: true })).toBeVisible();
  await page.evaluate(() => { window.__querytraceRenderFailure = true; });
  await expectStaticJoin(page, screenshotRequests);
  await expect(page.getByRole('heading', { name: 'Watch a query run.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the static join stays complete across screen sizes without WebGL or screenshot requests', async ({ page }) => {
  const screenshotRequests = watchOldScreenshotRequests(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
      return type === 'webgl2' ? null : original.call(this, type, options);
    } as typeof original;
  });
  await page.goto('/');
  await expectStaticJoin(page, screenshotRequests);
  await expect(page.getByRole('button', { name: 'Pause animation', exact: true })).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectStaticJoin(page, screenshotRequests);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Every label/value stays inside the illustration at both compositions.
    expect(await page.getByTestId('hero-static-join').locator('svg:visible').evaluate((svg: SVGSVGElement) => {
      const frame = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('text')].every((text) => {
        const bounds = text.getBoundingClientRect();
        return bounds.width > 0 && bounds.left >= frame.left && bounds.right <= frame.right
          && bounds.top >= frame.top && bounds.bottom <= frame.bottom;
      });
    })).toBe(true);
  }
});

test('homepage opens the tracer and runs a selected lesson with the QueryTrace tab title', async ({ page }) => {
  test.setTimeout(45_000);
  // Keep lesson-link clicks stable during back navigation and scrolling.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page).toHaveTitle('QueryTrace');
  await expect(page.getByRole('heading', { name: 'Watch a query run.', level: 1 })).toBeVisible();
  // The hero scene (a still frame under reduced motion, or the static join without WebGL).
  await expect(page.getByRole('img', { name: /joined on VENUE_ID/ })).toBeVisible();

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Open the tracer' }).click();
  await expect(page).toHaveURL(/\/trace$/);
  await expect(page).toHaveTitle('QueryTrace');
  await expect(page.getByLabel('SQL query editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();

  // Enter through a lesson link after the default schema has already loaded,
  // ensuring the route prepares the lesson's different database and runs it.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Watch a query run.', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: '1. Choose result columns', exact: false }).click();
  await expect(page).toHaveURL(/\/trace\?lesson=projection$/);
  await expect(page).toHaveTitle('QueryTrace');
  const finalStage = page.getByRole('tab', { name: /SELECT .*ROUTE_NAME.*ROUTE_CODE.*10 rows/ });
  await expect(finalStage).toBeVisible();
  await finalStage.click();
  const result = page.getByRole('table', { name: 'Query results' });
  await expect(result.getByRole('columnheader')).toHaveText(['ROUTE_NAME', 'ROUTE_CODE']);
  await expect(result.locator('[data-result-row]')).toHaveCount(10);
});
