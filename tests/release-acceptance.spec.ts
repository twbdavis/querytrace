import { expect, test, type Page } from '@playwright/test';
import { SOURCE_DIALECTS, dialectProfile } from '../lib/queryCompatibility';
import { RELEASE_CASES, validateReleaseCases } from '../scripts/releaseAcceptanceCases';

validateReleaseCases();
test.describe.configure({ mode: 'parallel' });
const cellText = (value: unknown) => value === null ? 'NULL'
  : typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(2) : String(value);

async function replaceSql(page: Page, sql: string) {
  const editor = page.getByLabel('SQL query editor');
  // Clear explicitly: WebKit can lose a contenteditable fill's initial selection.
  await editor.focus();
  await editor.press('ControlOrMeta+A');
  await editor.press('Backspace');
  const value = () => editor.evaluate((element) => element instanceof HTMLTextAreaElement
    ? element.value : [...element.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '').join('\n'));
  await expect.poll(value).toBe('');
  await editor.fill(sql);
  await expect.poll(value).toBe(sql);
}

for (const dialect of SOURCE_DIALECTS) {
  const label = dialectProfile(dialect).label;
  test(`${label}: 15 distinct queries return correct results through the editor and worker`, async ({ page }) => {
    test.setTimeout(120_000);
    const issues: string[] = [];
    page.on('pageerror', (error) => issues.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') issues.push(message.text()); });
    page.on('requestfailed', (request) => issues.push(`${request.url()}: ${request.failure()?.errorText}`));
    await page.goto('/trace');
    const run = page.getByRole('button', { name: 'RUN', exact: true }).first();
    const stages = page.getByRole('tab');
    const errors = page.locator('[role="alert"]:not(#__next-route-announcer__)');
    await expect(run).toBeEnabled();
    await page.getByRole('button', { name: 'Open schema settings' }).click();
    await page.getByRole('button', { name: /Independent film festival/ }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(run).toBeEnabled();

    const mode = page.locator('button[aria-haspopup="menu"]');
    await mode.click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${label}\\b`) }).click();
    await expect(mode).toHaveAccessibleName(`Mode ${label}: query dialect`);

    // A syntax error must leave the same worker usable for the full success streak.
    await replaceSql(page, 'SELECT FROM SCREENING');
    await run.click();
    await expect(errors).toBeVisible();
    await expect(page.getByRole('table', { name: 'Query results' })).toBeHidden();

    for (const [index, query] of RELEASE_CASES[dialect].entries()) {
      await test.step(`${index + 1}/15: ${query.note}`, async () => {
        await replaceSql(page, query.sql);
        await expect(stages).toHaveCount(0);
        await run.click();
        await expect(stages.last(), query.sql).toBeVisible();
        await expect(errors).toHaveCount(0);
        await stages.last().click();
        const table = page.getByRole('table', { name: 'Query results' });
        if (!query.rows!.length) {
          await expect(table).toBeHidden();
          await expect(page.getByText('Zero rows made it through this stage.', { exact: false })).toBeVisible();
          return;
        }
        if (query.columns) await expect(table.getByRole('columnheader')).toHaveText(query.columns);
        await expect(table.locator('[data-result-row]')).toHaveCount(query.rows!.length);
        const expected = query.rows!.map((row) => row.map(cellText));
        if (!query.ordered) expected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        await expect.poll(async () => {
          const rows = await table.locator('[data-result-row]').evaluateAll((elements) =>
            elements.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? '')));
          return query.ordered ? rows : rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        }, { message: query.sql }).toEqual(expected);
      });
    }
    expect(issues, 'browser, console and network errors').toEqual([]);
  });
}
