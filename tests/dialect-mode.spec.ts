import { expect, test, type Page } from '@playwright/test';

/* The query mode end to end: the top-bar button, the worker that reads the
   query under the chosen profile, the saved choice, and the lessons toggle
   that drives the same setting. The module suites cover each rule; this spec
   covers the wiring between them in a real browser. */

const editorFor = (page: Page) => page.getByLabel('SQL query editor');
const runButton = (page: Page) => page.getByRole('button', { name: 'RUN', exact: true }).first();
const modeButton = (page: Page) => page.locator('button[aria-haspopup="menu"]');
const result = (page: Page) => page.getByRole('table', { name: 'Query results' });
const errors = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

async function open(page: Page) {
  await page.goto('/trace');
  await expect(runButton(page)).toBeEnabled();
}

async function replaceSql(page: Page, sql: string) {
  const editor = editorFor(page);
  const value = () => editor.evaluate((element) => element instanceof HTMLTextAreaElement
    ? element.value : [...element.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '').join('\n'));
  // Use the editor's keyboard selection before filling. WebKit can lose a
  // native contenteditable fill selection during CodeMirror's first focus.
  await editor.focus();
  await editor.press('ControlOrMeta+A');
  await editor.press('Backspace');
  await expect.poll(value).toBe('');
  await editor.fill(sql);
  await expect.poll(value).toBe(sql);
}

async function runAndRead(page: Page, sql: string) {
  await replaceSql(page, sql);
  await runButton(page).click();
  await expect(page.getByRole('tab').last()).toBeVisible();
  await page.getByRole('tab').last().click();
  await expect(errors(page)).toHaveCount(0);
  return result(page).getByRole('cell');
}

async function chooseMode(page: Page, name: RegExp) {
  await modeButton(page).click();
  await page.getByRole('menuitemradio', { name }).click();
  await expect(page.getByRole('menu')).toBeHidden();
}

async function savedMode(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('querytrace');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string | undefined>((resolve, reject) => {
        const request = database.transaction('app-state').objectStore('app-state').get('current');
        request.onsuccess = () => resolve(request.result?.queryDialect);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
}

test('the mode button changes how the worker reads a query and the choice survives a reload', async ({ page }) => {
  await open(page);
  await expect(modeButton(page)).toHaveAccessibleName('Mode Any SQL: query dialect');

  // The same text means three things: + joins strings in SQL Server and in the
  // mixed default, and adds numbers in MySQL.
  const joined = "SELECT 'x' + 'y' AS joined";
  await expect(await runAndRead(page, joined)).toHaveText(['xy']);

  await chooseMode(page, /^MySQL/);
  await expect(modeButton(page)).toHaveAccessibleName('Mode MySQL: query dialect');
  // Changing the mode clears a trace that was built under other rules.
  await expect(result(page)).toBeHidden();
  await expect(await runAndRead(page, joined)).toHaveText(['0']);
  await expect.poll(() => savedMode(page)).toBe('mysql');

  await page.reload();
  await expect(runButton(page)).toBeEnabled();
  await expect(modeButton(page)).toHaveAccessibleName('Mode MySQL: query dialect');
  await expect(await runAndRead(page, joined)).toHaveText(['0']);
});

test('switching modes updates LIKE case rules without carrying the previous setting forward', async ({ page }) => {
  await open(page);
  await chooseMode(page, /^MySQL/);
  // LIKE compares letter case in PostgreSQL and not in MySQL, and the
  // setting must not carry over from one request to the next.
  const like = "SELECT 'Apple' LIKE 'a%' AS matches";
  await expect(await runAndRead(page, like)).toHaveText(['1']);
  await chooseMode(page, /^PostgreSQL/);
  await expect(await runAndRead(page, like)).toHaveText(['0']);
  await expect(page.getByRole('note', { name: 'Rewritten for SQLite' })).toContainText('comparing letter case as PostgreSQL does');
  await chooseMode(page, /^SQL Server/);
  await expect(await runAndRead(page, like)).toHaveText(['1']);
  await expect(await runAndRead(page, "SELECT 'x' + 'y' AS joined")).toHaveText(['xy']);
});

test('switching modes restores SQLite text functions and reapplies Unicode rules', async ({ page }) => {
  await open(page);
  await chooseMode(page, /^SQL Server/);
  // SQL Server and MySQL ignore letter case in every alphabet; SQLite itself
  // only for A to Z. The worker swaps the function in and back per request.
  const accented = "SELECT 'École' LIKE 'é%' AS matches, UPPER('é') AS upper";
  await expect(await runAndRead(page, accented)).toHaveText(['1', 'É']);
  await chooseMode(page, /^SQLite/);
  await expect(await runAndRead(page, accented)).toHaveText(['0', 'é']);
  await chooseMode(page, /^MySQL/);
  await expect(await runAndRead(page, accented)).toHaveText(['1', 'É']);
});

test('a CREATE typed in the editor follows the mode', async ({ page }) => {
  await open(page);
  await chooseMode(page, /^PostgreSQL/);
  await replaceSql(page, 'CREATE TABLE mode_probe ([id] INTEGER PRIMARY KEY)');
  await runButton(page).click();
  await expect(errors(page)).toContainText('[bracketed] names are SQL Server syntax, not PostgreSQL');
  await expect(page.getByTestId('rf__node-mode_probe')).toHaveCount(0);

  await chooseMode(page, /^SQL Server/);
  await replaceSql(page, 'CREATE TABLE mode_probe ([id] INTEGER PRIMARY KEY)');
  await runButton(page).click();
  await expect(errors(page)).toHaveCount(0);
  await expect(page.getByTestId('rf__node-mode_probe')).toBeAttached();
});

test('a refusal under one mode is explained and leaves no stale result behind', async ({ page }) => {
  await open(page);
  await expect(await runAndRead(page, 'SELECT 1 AS n # a MySQL comment')).toHaveText(['1']);
  await chooseMode(page, /^PostgreSQL/);
  await replaceSql(page, 'SELECT 1 AS n # a MySQL comment');
  await runButton(page).click();
  await expect(errors(page)).toContainText('# starts a comment in MySQL and MariaDB, not in PostgreSQL');
  await expect(result(page)).toBeHidden();
});

test('the lessons toggle and the mode button are one setting', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Open lessons', exact: true }).click();
  const toggle = page.getByRole('radiogroup', { name: 'Lesson dialect' });
  await expect(toggle.getByRole('radio', { name: 'Any SQL', exact: true })).toBeChecked();

  // PostgreSQL shows its own spelling of the pattern lesson, because LIKE compares letter case there.
  await toggle.getByRole('radio', { name: 'PostgreSQL', exact: true }).click();
  await expect(toggle.getByRole('radio', { name: 'PostgreSQL', exact: true })).toBeChecked();
  await expect(page.getByRole('dialog', { name: 'Lessons' })).toContainText("ILIKE '%the%'");

  // The arrow keys move the choice, as in any radio group.
  await toggle.getByRole('radio', { name: 'PostgreSQL', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(toggle.getByRole('radio', { name: 'SQL Server', exact: true })).toBeChecked();
  await expect(toggle.getByRole('radio', { name: 'SQL Server', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(toggle.getByRole('radio', { name: 'PostgreSQL', exact: true })).toBeChecked();

  await page.getByRole('button', { name: 'Close lessons' }).click();
  await expect(modeButton(page)).toHaveAccessibleName('Mode PostgreSQL: query dialect');
  await expect.poll(() => savedMode(page)).toBe('postgresql');

  // And the other way round: the button's choice is what the dialog shows next.
  await chooseMode(page, /^Oracle/);
  await page.getByRole('button', { name: 'Open lessons', exact: true }).click();
  await expect(toggle.getByRole('radio', { name: 'Oracle', exact: true })).toBeChecked();
  await expect(page.getByRole('dialog', { name: 'Lessons' })).toContainText("LOWER(FILM_TITLE) LIKE '%the%'");
});

test('running a lesson uses the spelling and the rules of the chosen mode', async ({ page }) => {
  await open(page);
  await chooseMode(page, /^PostgreSQL/);
  await page.getByRole('button', { name: 'Open lessons', exact: true }).click();
  await page.getByRole('button', { name: 'Run lesson: 5. Match patterns and ranges' }).click();
  await expect(page.getByRole('dialog', { name: 'Lessons' })).toBeHidden();
  await expect(page.getByRole('tab').last()).toBeVisible();
  await page.getByRole('tab').last().click();
  await expect(errors(page)).toHaveCount(0);
  // ILIKE ignores letter case, so both titles containing "the" are returned.
  await expect(result(page).locator('[data-result-row]')).toHaveCount(2);
  await expect(result(page)).toContainText('The Last Pollinator');
  await expect(result(page)).toContainText('Signal from the Attic');
});

test('the mode menu fits the screen, works from the keyboard and returns focus', async ({ page }) => {
  await open(page);
  await modeButton(page).focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio')).toHaveCount(7);
  // The current mode is the focused item.
  await expect(menu.getByRole('menuitemradio', { name: /^Any SQL/ })).toBeFocused();
  await expect(menu.getByRole('menuitemradio', { name: /^Any SQL/ })).toBeChecked();

  const viewport = page.viewportSize()!;
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: /^SQLite/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(modeButton(page)).toBeFocused();
  await expect(modeButton(page)).toHaveAccessibleName('Mode Any SQL: query dialect');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(modeButton(page)).toHaveAccessibleName('Mode Oracle: query dialect');
  await expect(modeButton(page)).toBeFocused();
});
