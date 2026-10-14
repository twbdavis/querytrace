import { expect, test } from '@playwright/test';

test('a stalled SQL worker restarts and restores the last successful bundled database', async ({ page }) => {
  test.setTimeout(35_000);
  // Drop one request to simulate a worker that cannot answer. This exercises
  // the real ten-second deadline without running hostile SQL on the host.
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    const counters = { created: 0, terminated: 0 };
    (window as Window & { recoveryWorkerCounts?: typeof counters }).recoveryWorkerCounts = counters;
    window.Worker = class extends OriginalWorker {
      private sqlWorker = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.sqlWorker = options?.name === 'querytrace-sql';
        if (this.sqlWorker) counters.created++;
      }
      postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        const request = message as { operation?: string; sql?: string };
        if (this.sqlWorker && request.operation === 'runQuery' && request.sql?.includes('stalled_marker')) return;
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options ?? {});
      }
      terminate() {
        if (this.sqlWorker) counters.terminated++;
        super.terminate();
      }
    };
  });
  await page.goto('/trace');
  const editor = page.getByLabel('SQL query editor');
  const run = page.getByRole('button', { name: 'RUN', exact: true }).first();
  const errors = page.locator('[role="alert"]:not(#__next-route-announcer__)');
  await expect(run).toBeEnabled();
  await editor.fill("UPDATE ASTRONOMER SET HOME_CITY = 'checkpoint-city' WHERE ASTRONOMER_ID = 1;");
  await run.click();
  await expect(page.getByRole('tab').last()).toBeVisible();
  await page.getByRole('tab').last().click();
  await expect(errors).toHaveCount(0);

  await editor.fill('SELECT 8675309 AS stalled_marker;');
  await run.click();
  await expect(errors).toContainText(/exceeded 10 seconds.*last successful database is preserved/i, { timeout: 12_000 });
  await editor.fill('SELECT HOME_CITY FROM ASTRONOMER WHERE ASTRONOMER_ID = 1;');
  await run.click();
  await expect(page.getByRole('tab').last()).toBeVisible();
  await page.getByRole('tab').last().click();
  await expect(errors).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Query results' }).getByRole('cell')).toHaveText(['checkpoint-city']);
  const counts = await page.evaluate(() => (window as Window & { recoveryWorkerCounts?: { created: number; terminated: number } }).recoveryWorkerCounts!);
  expect(counts.created).toBe(2);
  expect(counts.terminated).toBe(1);
});

test('editing SQL during an acknowledged mutation keeps canvas and saved data current without an obsolete trace', async ({ page }) => {
  test.setTimeout(35_000);
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      private delayedIds = new Set<number>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event) => {
          if (!this.delayedIds.delete(event.data?.id)) return;
          event.stopImmediatePropagation();
          setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: event.data })), 350);
        });
      }
      postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        const request = message as { id: number; operation?: string; sql?: string };
        if (request.operation === 'runQuery' && request.sql?.startsWith('UPDATE generation_sample')) this.delayedIds.add(request.id);
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options ?? {});
      }
    };
  });
  await page.goto('/trace');
  const editor = page.getByLabel('SQL query editor');
  const run = page.getByRole('button', { name: 'RUN', exact: true }).first();
  await expect(run).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill("CREATE TABLE generation_sample(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO generation_sample VALUES(1,'original');");
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await editor.fill("UPDATE generation_sample SET value='mutation_marker' WHERE id=1;");
  await run.click();
  const nextQuery = 'SELECT value FROM generation_sample;';
  await editor.fill(nextQuery);
  await expect(page.getByTestId('rf__node-generation_sample').locator('[data-table-row="1"]')).toContainText('mutation_marker');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect.poll(() => editor.evaluate((element) => 'value' in element ? (element as HTMLTextAreaElement).value : element.textContent)).toBe(nextQuery);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('querytrace', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const saved = await new Promise<{ customDatabase?: Uint8Array }>((resolve, reject) => { const request = db.transaction('app-state').objectStore('app-state').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return new TextDecoder().decode(saved.customDatabase).includes('mutation_marker');
    } finally { db.close(); }
  })).toBe(true);
  await page.reload();
  await expect(run).toBeEnabled();
  await expect(page.getByTestId('rf__node-generation_sample').locator('[data-table-row="1"]')).toContainText('mutation_marker');
});

test('prototype property SQL names remain ordinary data across the worker and rendering boundary', async ({ page }) => {
  const issues: string[] = [];
  page.on('pageerror', (error) => issues.push(error.message));
  await page.goto('/trace');
  const editor = page.getByLabel('SQL query editor');
  const run = page.getByRole('button', { name: 'RUN', exact: true }).first();
  await expect(run).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(['__proto__', 'constructor', 'toString'].map((name) => `CREATE TABLE "${name}"(id INTEGER PRIMARY KEY,amount INTEGER); INSERT INTO "${name}" VALUES(1,2),(2,3);`).join('\n'));
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const cases = [
    { sql: 'SELECT id, amount FROM "__proto__" ORDER BY id;', cells: ['1', '2', '2', '3'] },
    { sql: 'SELECT SUM(amount) AS total FROM "constructor";', cells: ['5'] },
    { sql: 'UPDATE "toString" SET amount=amount+1 WHERE id=1 RETURNING amount;', cells: ['3'] },
  ];
  for (const query of cases) {
    await editor.fill(query.sql);
    await run.click();
    await expect(page.getByRole('tab').last()).toBeVisible();
    await page.getByRole('tab').last().click();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Query results' }).getByRole('cell')).toHaveText(query.cells);
  }
  expect(issues).toEqual([]);
});
