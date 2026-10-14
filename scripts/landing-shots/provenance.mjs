// Captures the three provenance frames for the landing page's showcase tile:
// lesson 15 at its final stage with each result row pinned in turn, cropped to
// the result panel plus the VENUE and RESERVATION tables it lights up.
// Usage: start `next dev -p 3177` (or set QT_BASE), then `node scripts/landing-shots/provenance.mjs`.
import { chromium } from '@playwright/test';

const BASE = (process.env.QT_BASE ?? 'http://localhost:3177') + '/trace';
const OUT = 'public/landing';
const NAMES = ['beacon', 'orchard', 'riverside'];

async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('dev server did not come up');
}

await waitForServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
const lessons = page.getByRole('button', { name: 'Open lessons' });
for (let i = 0; i < 120 && !(await lessons.isEnabled()); i++) await page.waitForTimeout(500);
await lessons.click();
await page.getByRole('button', { name: 'Run lesson: 15. Trace a complete query pipeline' }).click();
await page.getByRole('tab').first().waitFor();
await page.waitForTimeout(600);
await page.keyboard.press('Escape');
const tabs = page.getByRole('tab');
await tabs.nth((await tabs.count()) - 1).click();
await page.waitForTimeout(900);

const rows = page.getByRole('table', { name: 'Query results' }).getByRole('row');
for (let i = 0; i < NAMES.length; i++) {
  await rows.nth(i + 1).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/provenance-${NAMES[i]}.png`, clip: { x: 0, y: 330, width: 1000, height: 400 } });
  await rows.nth(i + 1).click(); // unpin
  await page.waitForTimeout(200);
}
await browser.close();
console.log('done');
