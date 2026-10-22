import { expect, test } from '@playwright/test';
import { QUERY_SEQUENCE_CASES, QUERY_SEQUENCE_REJECTIONS, QUERY_SEQUENCE_SCHEMA } from '../scripts/querySequenceCases';

const cellText = (value: unknown) => value === null ? 'NULL'
  : typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(2) : String(value);

test('twenty-five consecutive mixed-dialect queries create schema objects and return correct results in one browser worker session', async ({ page }) => {
  test.setTimeout(150_000);
  expect(QUERY_SEQUENCE_CASES).toHaveLength(25);
  const issues: string[] = [];
  page.on('pageerror', (error) => issues.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') issues.push(message.text()); });
  page.on('requestfailed', (request) => issues.push(`${request.url()}: ${request.failure()?.errorText}`));

  await page.goto('/trace');
  const editor = page.getByLabel('SQL query editor');
  const run = page.getByRole('button', { name: 'RUN', exact: true }).first();
  const stages = page.getByRole('tab');
  const errors = page.locator('[role="alert"]:not(#__next-route-announcer__)');
  await expect(run).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(QUERY_SEQUENCE_SCHEMA.ddl);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('rf__node-purchase').locator('[data-table-row]')).toHaveCount(5);

  // Expected errors precede the uninterrupted success sequence. The same
  // worker and imported schema must recover without navigating or reloading.
  for (const rejection of QUERY_SEQUENCE_REJECTIONS) {
    await test.step(`Recover from ${rejection.name}`, async () => {
      await editor.fill(rejection.sql);
      await run.click();
      await expect(errors).toContainText(rejection.message);
      await expect(page.getByTestId('rf__node-purchase').locator('[data-table-row]')).toHaveCount(5);
    });
  }

  for (const [index, query] of QUERY_SEQUENCE_CASES.entries()) {
    await test.step(`${index + 1}/25 ${query.dialect}: ${query.name}`, async () => {
      await editor.fill(query.sql);
      await expect(stages).toHaveCount(0);
      await run.click();
      await expect(stages.last()).toBeVisible();
      await expect(errors).toHaveCount(0);
      await stages.last().click();
      const result = page.getByRole('table', { name: 'Query results' });
      await expect(result.getByRole('columnheader')).toHaveText(query.columns);
      await expect(result.locator('[data-result-row]')).toHaveCount(query.rows.length);
      await expect(result.getByRole('cell')).toHaveText(query.rows.flat().map(cellText));
      for (const table of query.schemaTables ?? []) await expect(page.getByTestId(`rf__node-${table}`)).toBeAttached();

      // Scrubbing a mutation back and forward must still show its original
      // snapshot and correct final values in the same session.
      if (query.changedTables) {
        await stages.first().click();
        await expect(errors).toHaveCount(0);
        await stages.last().click();
        await expect(result.getByRole('cell')).toHaveText(query.rows.flat().map(cellText));
      }
    });
  }
  await expect(page.getByTestId('rf__node-purchase').locator('[data-table-row]')).toHaveCount(5);
  await expect(page.getByTestId('rf__node-query_audit').locator('[data-table-row]')).toHaveCount(3);

  // Reload only after the twenty-five-query acceptance streak is complete.
  // The custom database must restore its created table and upserted values.
  await test.step('Created schema and data survive a browser reload', async () => {
    await page.reload();
    await expect(run).toBeEnabled();
    await expect(page.getByTestId('rf__node-query_audit').locator('[data-table-row]')).toHaveCount(3);
    await editor.fill(QUERY_SEQUENCE_CASES.at(-1)!.sql);
    await run.click();
    await expect(stages.last()).toBeVisible();
    await expect(errors).toHaveCount(0);
    await stages.last().click();
    const result = page.getByRole('table', { name: 'Query results' });
    await expect(result.getByRole('columnheader')).toHaveText(QUERY_SEQUENCE_CASES.at(-1)!.columns);
    await expect(result.getByRole('cell')).toHaveText(QUERY_SEQUENCE_CASES.at(-1)!.rows.flat().map(cellText));
  });
  expect(issues, 'no browser, worker, console or failed-network errors').toEqual([]);
});
