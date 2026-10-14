// Captures the real-app screenshots used on the landing page (public/landing).
// Usage: start `next dev -p 3177` (or set QT_BASE), then `node scripts/landing-shots/capture.mjs`.
import { chromium } from '@playwright/test';

const BASE = (process.env.QT_BASE ?? 'http://localhost:3177') + '/trace';
const OUT = 'public/landing';

async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('dev server did not come up');
}

async function waitReady(page) {
  const btn = page.getByRole('button', { name: 'Open lessons' });
  for (let i = 0; i < 120; i++) {
    if (await btn.isEnabled()) return;
    await page.waitForTimeout(500);
  }
  throw new Error('db never became ready');
}

async function openLesson(page, title) {
  await page.getByRole('button', { name: 'Open lessons' }).click();
  await page.getByRole('button', { name: `Run lesson: ${title}` }).click();
  await page.getByRole('tab').first().waitFor();
  await page.waitForTimeout(600);
}

async function stage(page, i) {
  const tabs = page.getByRole('tab');
  await tabs.nth(i).click();
  await page.waitForTimeout(900);
}

await waitForServer();
const browser = await chromium.launch();

// Desktop frames: 1600x1000 @2x
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
await page.getByRole('button', { name: 'RUN', exact: true }).first().waitFor();
await waitReady(page);

await openLesson(page, '15. Trace a complete query pipeline');
const tabCount = await page.getByRole('tab').count();
console.log('tabs', tabCount);
// pause autoplay so frames are deterministic
await page.keyboard.press('Escape');
// The landing frames show the canvas alone: fold both side panels away.
await page.getByRole('button', { name: 'Collapse query panel' }).click();
await page.getByRole('button', { name: 'Collapse result panel' }).click();
await page.waitForTimeout(600);
await stage(page, 1); // first JOIN
await page.screenshot({ path: `${OUT}/hero-join.png` });
await stage(page, 3); // WHERE
await page.screenshot({ path: `${OUT}/stage-where.png` });
await stage(page, 4); // GROUP BY
await page.screenshot({ path: `${OUT}/stage-group.png` });
await stage(page, tabCount - 1); // final
await page.screenshot({ path: `${OUT}/stage-final.png` });

// Schema modal
await page.getByRole('button', { name: 'Open schema settings' }).click();
await page.waitForTimeout(400);
await page.getByRole('dialog').screenshot({ path: `${OUT}/schema.png` });
await ctx.close();
await browser.close();
console.log('done');
