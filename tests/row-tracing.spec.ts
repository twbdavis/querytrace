import { expect, test } from '@playwright/test';

test('a pinned source stays highlighted through intermediate stages and hover previews', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE trace_parent (code TEXT PRIMARY KEY, category TEXT);
    CREATE TABLE trace_child (parent_code TEXT, note TEXT);
    INSERT INTO trace_parent VALUES ('beta', 'keep'), ('alpha', 'keep'), ('gone', 'drop'), ('empty', 'solo');
    INSERT INTO trace_child VALUES ('beta', 'same'), ('beta', 'same'), ('alpha', 'same'), ('gone', 'same');
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByLabel('SQL query editor').fill(`SELECT p.category, COUNT(c.parent_code) AS n
    FROM trace_parent p LEFT JOIN trace_child c ON p.code = c.parent_code
    WHERE p.code <> 'gone' GROUP BY p.category HAVING COUNT(*) >= 2 ORDER BY COUNT(c.parent_code) DESC`);
  await page.getByLabel('SQL query editor').press('Escape');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  const stages = page.getByRole('tab');
  await expect(stages).toHaveCount(7);
  await stages.first().click();
  const parent = page.getByTestId('rf__node-trace_parent');
  await parent.locator('[data-table-row="1"]').click();
  const result = page.getByRole('table', { name: 'Query results' });
  const highlighted = result.locator('.result-row-highlighted');
  const expectedCounts = [1, 2, 2, 1, 1, 1, 1];
  for (let i = 0; i < expectedCounts.length; i++) {
    await stages.nth(i).click();
    await expect(highlighted).toHaveCount(expectedCounts[i]);
    await expect(highlighted.first()).toContainText(i < 3 ? 'beta' : 'keep');
    const activeColumn = [null, 0, 0, 1, null, 1, null][i];
    if (activeColumn !== null) {
      const cells = parent.locator('[data-table-row="1"] > div');
      await expect(cells.nth(activeColumn)).toHaveAttribute('data-column-active', 'true');
      await expect(cells.nth(1 - activeColumn)).not.toHaveAttribute('data-column-active');
      expect(await cells.nth(activeColumn).evaluate((cell) => getComputedStyle(cell).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    }
    if (i === 1) {
      const pinned = result.getByRole('row').filter({ has: page.getByRole('cell', { name: 'beta', exact: true }) });
      await result.getByRole('row').filter({ has: page.getByRole('cell', { name: 'gone', exact: true }) }).hover();
      await expect(pinned).toHaveCount(2);
      for (const row of await pinned.all()) await expect(row).toHaveClass(/result-row-highlighted/);
      await parent.locator('[data-table-row="3"]').hover();
      for (const row of await pinned.all()) await expect(row).toHaveClass(/result-row-highlighted/);
    }
  }
  await stages.first().click();
  await parent.locator('[data-table-row="3"]').click();
  await stages.nth(2).click();
  await expect(highlighted).toHaveCount(0);
  await expect(page.getByText('The pinned row does not contribute to this stage’s results.')).toBeVisible();
  await stages.first().click();
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted).toContainText('gone');
  await page.getByRole('button', { name: 'Stop tracing this row' }).click();
  await expect(highlighted).toHaveCount(0);

  // Wildcards select every column, while filtered-out data stays unaccented.
  await page.getByLabel('SQL query editor').fill("SELECT p.* FROM trace_parent p WHERE p.code <> 'gone'");
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await expect(stages).toHaveCount(3);
  await stages.last().click();
  await expect(parent.locator('[data-column-active="true"]')).toHaveCount(6);
  await expect(parent.locator('[data-table-row="3"] [data-column-active]')).toHaveCount(0);
});

test('a pin outside the initial result window is revealed after joining, filtering and sorting', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE trace_many (id INTEGER PRIMARY KEY);
    CREATE TABLE trace_one (id INTEGER PRIMARY KEY);
    INSERT INTO trace_many VALUES ${Array.from({ length: 120 }, (_, i) => `(${i + 1})`).join(',')};
    INSERT INTO trace_one VALUES (1);
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByLabel('SQL query editor').fill('SELECT m.id FROM trace_many m CROSS JOIN trace_one o WHERE m.id > 0 ORDER BY m.id DESC');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  const stages = page.getByRole('tab');
  await expect(stages).toHaveCount(5);
  await stages.last().click();
  const result = page.getByRole('table', { name: 'Query results' });
  await result.locator('[data-result-row="0"]').click();
  for (const i of [0, 1, 2, 3, 4, 1]) {
    await stages.nth(i).click();
    const pin = result.locator('.result-row-highlighted');
    await expect(pin).toHaveCount(1);
    await expect(pin).toBeVisible();
    await expect(pin.getByRole('cell').first()).toHaveText('120');
    await expect(result).toHaveAttribute('aria-rowcount', '121');
    expect(await result.locator('[data-result-row]').count()).toBeLessThan(80);
  }
});
