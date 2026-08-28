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

  await editor.fill("SELECT GIVEN_NAME FROM ASTRONOMER WHERE HOME_CITY = 'Tucson'");
  await editor.click();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.queryExecHighlight')).toBeVisible();
  await expect(page.getByText('2 rows', { exact: true }).first()).toBeVisible();

  if ((page.viewportSize()?.width ?? 0) < 640) {
    // The mobile sheet is deliberately not tabbed: the active query clause
    // and the intermediate rows must remain visible at the same time.
    await expect(editor).toBeVisible();
    await expect(page.getByText('intermediate rows', { exact: true })).toBeVisible();
  }

  // Editing invalidates the old teaching trace immediately; otherwise the
  // visible SQL could disagree with rows still advancing from a prior query.
  await editor.fill('SELECT GIVEN_NAME FROM ASTRONOMER');
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
    .getByRole('button', { name: 'Run lesson: 1. Choose result columns' })
    .click();
  await expect(page.getByText('10 rows', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE SAVED_GARDEN (
      BED_ID INTEGER PRIMARY KEY,
      HERB_NAME VARCHAR(40) NOT NULL
    );
    INSERT INTO SAVED_GARDEN VALUES (1, 'Sage'), (2, 'Thyme');
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByTestId('rf__node-SAVED_GARDEN')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('rf__node-SAVED_GARDEN')).toBeVisible();
  await page.getByRole('button', { name: 'Open lessons' }).click();
  await expect(page.getByText('1 / 19 run', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close lessons' }).click();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await expect(page.getByLabel('Schema definition SQL')).toContainText('CREATE TABLE SAVED_GARDEN');
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
  await page.getByRole('button', { name: 'Run lesson: 6. Keep unique results with DISTINCT' }).click();
  await expect(page.getByRole('tab', { name: /SELECT DISTINCT .*PASS_TYPE.* - 4 rows/ })).toBeVisible();

  await page.getByRole('button', { name: 'Open lessons' }).click();
  await page.getByRole('button', { name: 'Run lesson: 18. Stack compatible results' }).click();
  const unionFinal = page.getByRole('tab', { name: /UNION - final 6 rows/ });
  await expect(unionFinal).toBeVisible();
  await unionFinal.click();
  await expect(page.getByText('6 rows', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Open lessons' }).click();
  await page.getByRole('button', { name: 'Run lesson: 19. Feed one query into another' }).click();
  const subqueryFinal = page.getByRole('tab', { name: /SELECT .* 4 rows/ }).last();
  await expect(page.getByRole('tab', { name: /SUBQUERY 1 - 1 row/ })).toBeVisible();
  await subqueryFinal.click();
  await expect(page.getByRole('cell', { name: 'River Market', exact: true })).toBeVisible();
});

test('handles custom-schema edge cases and semicolon-terminated queries', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'One engine is sufficient for deterministic edge validation.');
  await page.goto('/');
  await expect(page.getByLabel('SQL query editor')).toBeVisible();

  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(`
    -- Semicolons in comments are harmless; this one is not a statement: ;
    CREATE TABLE GARDEN_SECTOR (
      SECTOR_ID INTEGER PRIMARY KEY,
      LABEL VARCHAR(30) NOT NULL
    );
    CREATE TABLE SAMPLE (
      SECTOR_ID INTEGER,
      SAMPLE_NO INTEGER,
      NOTE VARCHAR(30),
      READING REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (SECTOR_ID, SAMPLE_NO),
      CONSTRAINT sample_sector_fk FOREIGN KEY (SECTOR_ID)
        REFERENCES GARDEN_SECTOR (SECTOR_ID) ON DELETE CASCADE
    );
    INSERT INTO GARDEN_SECTOR VALUES (1, 'North; Annex'), (2, 'South Bed');
    INSERT INTO SAMPLE VALUES
      (1, 1, 'first', 4.5),
      (1, 2, NULL, 0),
      (2, 1, 'control', 7.25);
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog', { name: 'Schema' })).toBeHidden();
  await expect(page.getByTestId('rf__node-GARDEN_SECTOR')).toBeVisible();
  await expect(page.getByTestId('rf__node-SAMPLE')).toBeVisible();

  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('SELECT * FROM GARDEN_SECTOR;');
  await editor.fill(`SELECT G.LABEL, COUNT(S.SAMPLE_NO) AS 'Samples'
    FROM GARDEN_SECTOR G
    LEFT OUTER JOIN SAMPLE S ON G.SECTOR_ID = S.SECTOR_ID
    GROUP BY G.LABEL
    ORDER BY COUNT(S.SAMPLE_NO) DESC;`);
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await expect(page.getByText('2 rows', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'North; Annex', exact: true })).toBeVisible();

  await editor.fill('SELECT SAMPLE_NO, NOTE FROM SAMPLE WHERE NOTE IS NULL;');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await expect(page.getByText('1 row', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '2', exact: true })).toBeVisible();

  await editor.fill('SELECT * FROM SAMPLE; SELECT * FROM GARDEN_SECTOR;');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await expect(page.getByText(/run one statement at a time/i)).toBeVisible();

  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE PARENT_EDGE (ID INTEGER PRIMARY KEY);
    CREATE TABLE CHILD_EDGE (
      ID INTEGER PRIMARY KEY,
      PARENT_ID INTEGER,
      CONSTRAINT child_edge_fk FOREIGN KEY (PARENT_ID) REFERENCES PARENT_EDGE (ID)
    );
    INSERT INTO CHILD_EDGE VALUES (1, 999);
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  const schemaDialog = page.getByRole('dialog', { name: 'Schema' });
  await expect(schemaDialog.getByRole('alert')).toContainText(/foreign key constraint failed/i);

  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE DUPLICATE_EDGE (
      PART_A INTEGER,
      PART_B INTEGER,
      PRIMARY KEY (PART_A, PART_B)
    );
    INSERT INTO DUPLICATE_EDGE VALUES (1, 2), (1, 2);
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(schemaDialog.getByRole('alert')).toContainText(/unique constraint failed/i);
});

test('enforces relational keys and aggregate rules with actionable feedback', async ({
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
  await editor.fill('SELECT LABEL, COUNT(*) FROM AUTO_TEST');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await expect(
    page.getByText(/scalar aggregate cannot be selected with individual columns/i)
  ).toBeVisible();
});
