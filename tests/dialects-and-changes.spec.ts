import { expect, test } from '@playwright/test';

const editorFor = (page: import('@playwright/test').Page) => page.getByLabel('SQL query editor');
const runButton = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'RUN', exact: true }).first();

test('MySQL and SQL Server spellings run and are explained beside the result', async ({ page }) => {
  await page.goto('/');
  await expect(runButton(page)).toBeEnabled();
  await editorFor(page).fill("SELECT TOP 3 `GIVEN_NAME`, YEAR('2026-03-12') AS yr FROM `ASTRONOMER` WHERE HOME_CITY ILIKE 'tucson' OR `HOME_CITY` <=> 'Flagstaff' ORDER BY GIVEN_NAME");
  await runButton(page).click();
  const stages = page.getByRole('tab');
  await expect(stages).toHaveCount(4);
  await stages.last().click();
  const result = page.getByRole('table', { name: 'Query results' });
  await expect(result.locator('[data-result-row]')).toHaveCount(3);
  await expect(result).toContainText('2026');
  const notes = page.getByRole('note', { name: 'Rewritten for SQLite' });
  await expect(notes).toBeVisible();
  await expect(notes).toContainText('TOP 3');
  await expect(notes).toContainText('LIMIT 3');
  await expect(notes).toContainText('ILIKE');
  await expect(notes).toContainText('YEAR()');
  // Editing the query clears the notes with the trace.
  await editorFor(page).fill('SELECT GIVEN_NAME FROM ASTRONOMER');
  await expect(notes).toBeHidden();
});

test('INSERT, UPDATE and DELETE trace a before state, the matched rows and the applied change', async ({ page }) => {
  await page.goto('/');
  await expect(runButton(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE customers (customer_id VARCHAR(50) PRIMARY KEY, company_name VARCHAR(100) NOT NULL, status VARCHAR(50));
    CREATE TABLE equipment (equipment_id VARCHAR(50) PRIMARY KEY, customer_id VARCHAR(50) REFERENCES customers(customer_id) ON DELETE CASCADE, model VARCHAR(50));
    INSERT INTO customers VALUES ('C1', 'Acme', 'Active'), ('C2', 'Bolt', 'Inactive');
    INSERT INTO equipment VALUES ('E1', 'C1', 'GenX'), ('E2', 'C2', 'GenY');
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  const customers = page.getByTestId('rf__node-customers');
  await expect(customers.locator('[data-table-row]')).toHaveCount(2);

  await editorFor(page).fill("UPDATE customers SET status = 'Closed' WHERE customer_id = 'C2'");
  await runButton(page).click();
  const stages = page.getByRole('tab');
  await expect(stages).toHaveCount(3);
  await expect(stages.nth(0)).toHaveAttribute('aria-label', /UPDATE customers - 2 rows before/);
  await expect(stages.nth(1)).toHaveAttribute('aria-label', /WHERE .* - 1 row matches/);
  await expect(stages.nth(2)).toHaveAttribute('aria-label', /UPDATE customers - 1 row changed/);
  // Earlier stages keep showing the value before the change; the last stage shows the live table.
  await stages.nth(1).click();
  await expect(customers).toContainText('Inactive');
  await stages.nth(2).click();
  await expect(customers).toContainText('Closed');
  await expect(customers).not.toContainText('Inactive');
  await expect(page.getByRole('table', { name: 'Query results' })).toContainText('Closed');

  await editorFor(page).fill("DELETE FROM customers WHERE customer_id = 'C1'");
  await runButton(page).click();
  await expect(stages).toHaveCount(3);
  await stages.last().click();
  await expect(customers.locator('[data-table-row]')).toHaveCount(1);
  await expect(page.getByTestId('rf__node-equipment').locator('[data-table-row]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show stage explanation' }).click();
  await expect(page.getByRole('region', { name: 'Stage explanation' })).toContainText('equipment: 1 row removed');

  // A rejected statement rolls back and explains itself; nothing changes on the canvas.
  await editorFor(page).fill("INSERT INTO equipment VALUES ('E9', 'C404', 'Ghost')");
  await runButton(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'rejected' })).toContainText('foreign-key value does not match any row in the parent table');
  await expect(page.getByTestId('rf__node-equipment').locator('[data-table-row]')).toHaveCount(1);

  // Changes to a custom schema survive a reload because the saved database holds them.
  await page.reload();
  await expect(runButton(page)).toBeEnabled();
  await expect(page.getByTestId('rf__node-customers').locator('[data-table-row]')).toHaveCount(1);
  await expect(page.getByTestId('rf__node-customers')).toContainText('Closed');
});

test('a lesson restores the bundled rows after a data change in the same schema', async ({ page }) => {
  await page.goto('/');
  await expect(runButton(page)).toBeEnabled();
  await editorFor(page).fill("DELETE FROM OBSERVATION WHERE ASTRONOMER_ID = 1");
  await runButton(page).click();
  await page.getByRole('tab').last().click();
  await expect(page.getByTestId('rf__node-OBSERVATION').locator('[data-table-row]')).toHaveCount(8);
  await page.getByRole('button', { name: 'Open lessons' }).click();
  await page.getByRole('button', { name: 'Run lesson: 7. Label a combined text field' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('rf__node-OBSERVATION').locator('[data-table-row]')).toHaveCount(10);
});

test('a failing schema statement is reported and selected in place without closing the dialog', async ({ page }) => {
  await page.goto('/');
  await expect(runButton(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  const ddl = page.getByLabel('Schema definition SQL');
  const script = [
    'CREATE TABLE customers (customer_id VARCHAR(50) PRIMARY KEY, company_name VARCHAR(100)) ENGINE=InnoDB;',
    'CREATE TABLE equipment (equipment_id VARCHAR(50) PRIMARY KEY, customer_id VARCHAR(50), Customer_ID INT) ENGINE=InnoDB;',
    "INSERT INTO customers VALUES ('C1', 'Acme');",
  ].join('\n\n');
  await ddl.fill(script);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('CREATE TABLE equipment: duplicate column name: Customer_ID');
  await expect(ddl).toHaveValue(script);
  const selection = await ddl.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  });
  expect(selection.startsWith('CREATE TABLE equipment')).toBeTruthy();
  // Fix it in place and build: the dialog closes only on success.
  await ddl.fill(script.replace(', Customer_ID INT', ''));
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('rf__node-equipment')).toBeVisible();
});
