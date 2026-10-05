import { expect, test } from '@playwright/test';

test('homepage opens the tracer and runs a selected lesson with the QueryTrace tab title', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/');
  await expect(page).toHaveTitle('QueryTrace');
  await expect(page.getByRole('heading', { name: 'See the query run.', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Stage shown in the preview' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Open the tracer' }).click();
  await expect(page).toHaveURL(/\/trace$/);
  await expect(page).toHaveTitle('QueryTrace');
  await expect(page.getByLabel('SQL query editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();

  // Enter through a lesson link after the default schema has already loaded,
  // ensuring the route prepares the lesson's different database and runs it.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'See the query run.', exact: true })).toBeVisible();
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
