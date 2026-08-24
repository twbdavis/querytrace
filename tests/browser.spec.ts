import { expect, test } from '@playwright/test';

test('loads, edits, and traces without browser or policy errors', async ({ page }) => {
  const issues: string[] = [];
  const externalRequests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') issues.push(`console: ${message.text().slice(0, 300)}`);
  });
  page.on('pageerror', (error) => issues.push(`page: ${error.message}`));
  page.on('requestfailed', (request) => {
    issues.push(`request: ${request.url()} (${request.failure()?.errorText ?? 'failed'})`);
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== 'http://127.0.0.1:3100') {
      externalRequests.push(request.url());
    }
  });

  const wasmResponse = page.waitForResponse((response) => response.url().endsWith('.wasm'));
  const started = Date.now();
  const response = await page.goto('/');
  const editor =
    (page.viewportSize()?.width ?? 0) >= 640
      ? page.locator('.cm-content')
      : page.locator('textarea[aria-label="SQL query editor"]');
  await expect(editor).toBeVisible();
  const editorReadyMs = Date.now() - started;
  expect(editorReadyMs).toBeLessThan(3_000);

  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
  expect(headers['content-security-policy']).not.toContain("'unsafe-eval'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');

  const wasm = await wasmResponse;
  expect(wasm.headers()['content-type']).toContain('application/wasm');
  expect(wasm.url()).toMatch(/sql-wasm-browser\.[a-f0-9]{12}\.wasm$/);
  expect(wasm.headers()['cache-control']).toContain('max-age=31536000');
  expect(wasm.headers()['cache-control']).toContain('immutable');

  await editor.fill('SELECT name FROM student WHERE gpa >= 3.7');
  await editor.click();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.queryExecHighlight')).toBeVisible();
  await expect(page.getByText('4 rows', { exact: true }).first()).toBeVisible();

  if ((page.viewportSize()?.width ?? 0) < 640) {
    // The mobile sheet is deliberately not tabbed: the active query clause
    // and the intermediate rows must remain visible at the same time.
    await expect(editor).toBeVisible();
    await expect(page.getByText('intermediate rows', { exact: true })).toBeVisible();
  }

  // Editing invalidates the old teaching trace immediately; otherwise the
  // visible SQL could disagree with rows still advancing from a prior query.
  await editor.fill('SELECT name FROM student');
  await expect(page.getByRole('tablist', { name: 'Execution stages' })).toBeHidden();
  await expect(page.getByText(/Rows will fill in here stage by stage/)).toBeVisible();

  const viewport = await page.evaluate(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(viewport.scrollWidth).toBe(viewport.innerWidth);
  expect(viewport.scrollHeight).toBe(viewport.innerHeight);
  expect(externalRequests).toEqual([]);
  expect(issues).toEqual([]);
});

test('restores custom SQLite data and lesson progress from IndexedDB', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/');
  await expect(page.getByLabel('SQL query editor')).toBeVisible();

  await page.getByRole('button', { name: 'Open lessons' }).click();
  await page
    .getByRole('button', { name: 'Run lesson: 1. SELECT ... FROM (projection)' })
    .click();
  await expect(page.getByText('10 rows', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE SAVED_CLASS (
      STUDENT_ID INTEGER PRIMARY KEY,
      STUDENT_NAME VARCHAR(40) NOT NULL
    );
    INSERT INTO SAVED_CLASS VALUES (1, 'Ada'), (2, 'Grace');
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByTestId('rf__node-SAVED_CLASS')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('rf__node-SAVED_CLASS')).toBeVisible();
  await page.getByRole('button', { name: 'Open lessons' }).click();
  await expect(page.getByText('1 / 19 run', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close lessons' }).click();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await expect(page.getByLabel('Schema definition SQL')).toContainText('CREATE TABLE SAVED_CLASS');
});

test('rejects executable custom-schema operations outside the safe subset', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'One engine is sufficient for deterministic input validation.');
  await page.goto('/');
  await expect(page.getByLabel('SQL query editor')).toBeVisible();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill("ATTACH DATABASE 'other.db' AS other;");
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByText(/Custom schemas may contain only CREATE TABLE/)).toBeVisible();
});

test('runs curriculum DISTINCT, UNION, and subquery lessons through the teaching UI', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('SQL query editor')).toBeVisible();

  await page.getByRole('button', { name: 'Open lessons' }).click();
  await expect(page.getByText('0 / 19 run', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run lesson: 6. DISTINCT (remove duplicate rows)' }).click();
  await expect(page.getByRole('tab', { name: /SELECT DISTINCT .*DSTATE.* - 15 rows/ })).toBeVisible();

  await page.getByRole('button', { name: 'Open lessons' }).click();
  await page.getByRole('button', { name: 'Run lesson: 18. UNION and UNION ALL' }).click();
  const unionFinal = page.getByRole('tab', { name: /UNION - 36 final rows/ });
  await expect(unionFinal).toBeVisible();
  await unionFinal.click();
  await expect(page.getByText('36 rows', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Open lessons' }).click();
  await page.getByRole('button', { name: 'Run lesson: 19. Subqueries' }).click();
  const subqueryFinal = page.getByRole('tab', { name: /SELECT .* 1 rows/ }).last();
  await expect(page.getByRole('tab', { name: /SUBQUERY 1 - 1 rows/ })).toBeVisible();
  await subqueryFinal.click();
  await expect(page.getByRole('cell', { name: 'Beckman', exact: true })).toBeVisible();
});

test('enforces relational keys and course aggregate rules with actionable feedback', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'One engine is sufficient for deterministic validation.');
  await page.goto('/');
  await expect(page.getByLabel('SQL query editor')).toBeVisible();

  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(
    'CREATE TABLE NO_KEY (VALUE VARCHAR(20)); INSERT INTO NO_KEY VALUES (\'duplicateable\');'
  );
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Table "NO_KEY"' })).toBeVisible();
  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE BAD_COMPOSITE (
      PART_A INTEGER,
      PART_B INTEGER,
      PRIMARY KEY (PART_A, PART_B)
    );
    INSERT INTO BAD_COMPOSITE VALUES (NULL, 1);
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByText(/cannot contain NULL values \(entity integrity\)/)).toBeVisible();
  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE AUTO_TEST (
      ID INTEGER PRIMARY KEY AUTO_INCREMENT,
      LABEL VARCHAR(20) NOT NULL DEFAULT 'New'
    );
    INSERT INTO AUTO_TEST (LABEL) VALUES ('First');
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog', { name: 'Schema' })).toBeHidden();
  await expect(page.getByTestId('rf__node-AUTO_TEST')).toBeVisible();
  await expect(page.getByTitle(/ID INTEGER — primary key:.*never be NULL/)).toBeVisible();
  await expect(page.getByTitle(/LABEL VARCHAR\(20\).*NOT NULL.*default 'New'/)).toBeVisible();

  const editor = page.locator('.cm-content');
  await editor.fill('SELECT DLNAME, COUNT(*) FROM DONOR');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await expect(
    page.getByText(/scalar aggregate cannot be selected with individual columns/i)
  ).toBeVisible();
});
