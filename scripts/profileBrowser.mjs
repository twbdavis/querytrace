// Run against a production server: node scripts/profileBrowser.mjs
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3100');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE P (ID INTEGER PRIMARY KEY);
    CREATE TABLE C (ID INTEGER PRIMARY KEY);
    INSERT INTO P VALUES ${Array.from({ length: 200 }, (_, i) => `(${i + 1})`).join(',')};
    INSERT INTO C VALUES ${Array.from({ length: 50 }, (_, i) => `(${i + 1})`).join(',')};
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.locator('.cm-content').fill('SELECT P.ID AS P_ID, C.ID AS C_ID FROM P CROSS JOIN C');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await page.getByRole('tab').last().waitFor();
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const before = await metrics();
  const start = performance.now();
  await page.getByRole('tab').last().click();
  await page.getByRole('cell').first().waitFor();
  const renderMs = performance.now() - start;
  await page.waitForTimeout(1200); // Include completion of the row entrance.
  const after = await metrics();
  const hoverStart = await metrics();
  for (let i = 0; i < 10; i++) await page.locator('tbody tr').filter({ has: page.locator('td') }).nth(i).hover();
  const hoverEnd = await metrics();
  console.log(JSON.stringify({
    rows: 10000,
    mountedResultRows: await page.locator('tbody tr').count(),
    renderMs: Math.round(renderMs),
    renderTaskMs: Math.round((after.TaskDuration - before.TaskDuration) * 1000),
    hoverTaskMs: Math.round((hoverEnd.TaskDuration - hoverStart.TaskDuration) * 1000),
    layoutMs: Math.round((after.LayoutDuration - before.LayoutDuration) * 1000),
    domNodes: after.Nodes,
  }, null, 2));
  if (process.argv.includes('--screenshot')) {
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/performance-desktop.png' });
    const mobile = await page.context().newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto('http://127.0.0.1:3100');
    await mobile.getByTestId('rf__node-P').waitFor();
    await mobile.getByLabel('SQL query editor').fill('SELECT P.ID AS P_ID, C.ID AS C_ID FROM P CROSS JOIN C');
    await mobile.getByRole('button', { name: 'RUN', exact: true }).click();
    await mobile.getByRole('tab').last().click();
    await mobile.getByRole('table', { name: 'Query results' }).waitFor();
    await mobile.screenshot({ path: 'test-results/performance-mobile.png' });
  }
} finally {
  await browser.close();
}
