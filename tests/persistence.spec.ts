import { expect, test, type Page } from '@playwright/test';

type SchemaBuildGateWindow = Window & {
  schemaBuildGate?: { held: boolean; arm: () => void; release: () => void };
};

const ddl = "CREATE TABLE durable_probe (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO durable_probe VALUES (1, 'original');";
const run = (page: Page) => page.getByRole('button', { name: 'RUN', exact: true }).first();
const rows = (page: Page) => page.getByTestId('rf__node-durable_probe').locator('[data-table-row]');
const errors = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

async function open(page: Page) {
  await page.goto('/trace');
  await expect(run(page)).toBeEnabled();
}

async function build(page: Page) {
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(ddl);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(rows(page)).toContainText('original');
}

async function query(page: Page, sql: string) {
  await page.getByLabel('SQL query editor').fill(sql);
  await run(page).click();
  await expect(page.getByRole('tab').last()).toBeVisible();
  await page.getByRole('tab').last().click();
  await expect(errors(page)).toHaveCount(0);
}

async function savedRevision(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('querytrace');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = database.transaction('app-state').objectStore('app-state').get('current');
        request.onsuccess = () => resolve(request.result?.customRevision ?? 0);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
}

test('resume retains custom data and created tables after a lesson and a reload', async ({ page }) => {
  await open(page);
  await build(page);
  await query(page, "UPDATE durable_probe SET value='updated';");
  await query(page, 'CREATE TABLE saved_structure (id INTEGER PRIMARY KEY);');
  await expect.poll(() => savedRevision(page)).toBe(3);
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByRole('button', { name: /Night observatory/ }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await expect(run(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByRole('button', { name: 'RESUME SAVED SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(rows(page)).toContainText('updated');
  await expect(page.getByTestId('rf__node-saved_structure')).toBeAttached();
  expect(await savedRevision(page)).toBe(3);
  await page.reload();
  await expect(run(page)).toBeEnabled();
  await expect(rows(page)).toContainText('updated');
  await expect(page.getByTestId('rf__node-saved_structure')).toBeAttached();
});

test('stale settings and lesson writes cannot revert a newer custom checkpoint', async ({ page, context }) => {
  await open(page);
  await build(page);
  const stale = await context.newPage();
  await open(stale);
  await expect(rows(stale)).toContainText('original');
  await query(page, "UPDATE durable_probe SET value='updated';");
  await expect.poll(() => savedRevision(page)).toBe(2);
  await stale.getByRole('button', { name: 'Open schema settings' }).click();
  await stale.getByRole('button', { name: 'Close schema settings' }).click();
  await stale.getByRole('button', { name: 'Open schema settings' }).click();
  await stale.getByRole('button', { name: /Night observatory/ }).click();
  await expect(stale.getByRole('dialog')).toBeHidden();
  await stale.getByRole('button', { name: 'Open schema settings' }).click();
  await stale.getByRole('button', { name: 'RESUME SAVED SCHEMA' }).click();
  await expect(stale.getByRole('dialog')).toBeHidden();
  await expect(rows(stale)).toContainText('updated');
  expect(await savedRevision(page)).toBe(2);
  await page.reload();
  await expect(run(page)).toBeEnabled();
  await expect(rows(page)).toContainText('updated');
});

test('simultaneous custom mutations reject a stale writer and restore the winning checkpoint', async ({ page, context }) => {
  await open(page);
  await build(page);
  const other = await context.newPage();
  await open(other);
  await expect(rows(other)).toContainText('original');
  const firstSql = "UPDATE durable_probe SET value='first-tab';";
  const secondSql = "UPDATE durable_probe SET value='second-tab';";
  await page.getByLabel('SQL query editor').fill(firstSql);
  await other.getByLabel('SQL query editor').fill(secondSql);
  await Promise.all([run(page).click(), run(other).click()]);
  await expect.poll(async () => (await errors(page).count()) + (await errors(other).count())).toBe(1);
  const rejected = (await errors(page).count()) ? page : other;
  const winner = rejected === page ? other : page;
  const value = winner === page ? 'first-tab' : 'second-tab';
  await expect(errors(rejected)).toContainText('This change was not saved. The latest saved data has been restored.');
  await expect(rows(rejected)).toContainText(value);
  await expect.poll(() => savedRevision(page)).toBe(2);
  await rejected.reload();
  await expect(run(rejected)).toBeEnabled();
  await expect(rows(rejected)).toContainText(value);
  await query(rejected, "UPDATE durable_probe SET value='reviewed-retry';");
  await expect.poll(() => savedRevision(rejected)).toBe(3);
  await rejected.reload();
  await expect(run(rejected)).toBeEnabled();
  await expect(rows(rejected)).toContainText('reviewed-retry');
});

test('rapid writes in one tab save in order without conflicting with themselves', async ({ page }) => {
  await open(page);
  await build(page);
  await page.getByLabel('SQL query editor').fill("UPDATE durable_probe SET value=value || 'x';");
  await run(page).dblclick();
  await expect.poll(() => savedRevision(page)).toBe(3);
  await expect(errors(page)).toHaveCount(0);
  await page.reload();
  await expect(run(page)).toBeEnabled();
  await expect(rows(page)).toContainText('originalxx');
});

test('a stale rebuild preserves its SQL draft and cannot replace another tab’s saved database', async ({ page, context }) => {
  await open(page);
  await build(page);
  const stale = await context.newPage();
  await open(stale);
  await query(page, "UPDATE durable_probe SET value='updated';");
  await expect.poll(() => savedRevision(page)).toBe(2);
  const replacement = "CREATE TABLE replacement (id INTEGER PRIMARY KEY);";
  await stale.getByRole('button', { name: 'Open schema settings' }).click();
  await stale.getByLabel('Schema definition SQL').fill(replacement);
  await stale.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(stale.getByRole('dialog').getByRole('alert')).toContainText('This change was not saved.');
  await expect(stale.getByLabel('Schema definition SQL')).toHaveValue(replacement);
  await stale.getByRole('button', { name: 'Close schema settings' }).click();
  await expect(rows(stale)).toContainText('updated');
  await stale.reload();
  await expect(run(stale)).toBeEnabled();
  await expect(rows(stale)).toContainText('updated');
  await stale.getByRole('button', { name: 'Open schema settings' }).click();
  await expect(stale.getByLabel('Schema definition SQL')).toHaveValue(replacement);
});

test('schema loading blocks queries and preserves edits newer than the submitted SQL', async ({ page }) => {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    let armed = false;
    let sendHeldRequest: (() => void) | undefined;
    const gate = {
      held: false,
      arm() { armed = true; },
      release() {
        if (!sendHeldRequest) throw new Error('No schema build is waiting at the gate.');
        const send = sendHeldRequest;
        sendHeldRequest = undefined;
        send();
      },
    };
    (window as SchemaBuildGateWindow).schemaBuildGate = gate;
    window.Worker = class extends OriginalWorker {
      private sqlWorker = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.sqlWorker = options?.name === 'querytrace-sql';
      }
      postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        const request = message as { operation?: string; def?: { id?: string } };
        const send = () => {
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options ?? {});
        };
        if (this.sqlWorker && armed && request.operation === 'loadSchema' && request.def?.id === 'custom') {
          armed = false;
          sendHeldRequest = send;
          gate.held = true;
        } else send();
      }
    };
  });
  await open(page);
  // Hold this build until the loading assertion completes. Reloaded pages
  // start unarmed, so restoring the saved checkpoint uses the real worker.
  await page.evaluate(() => (window as SchemaBuildGateWindow).schemaBuildGate!.arm());
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(ddl);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect.poll(() => page.evaluate(() => (window as SchemaBuildGateWindow).schemaBuildGate?.held)).toBe(true);
  const newer = `${ddl}\n-- newer draft to keep`;
  await page.getByLabel('Schema definition SQL').fill(newer);
  await page.getByRole('button', { name: 'Close schema settings' }).click();
  await expect(run(page)).toBeDisabled();
  await page.evaluate(() => (window as SchemaBuildGateWindow).schemaBuildGate!.release());
  await expect(run(page)).toBeEnabled();
  await expect(rows(page)).toContainText('original');
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await expect(page.getByLabel('Schema definition SQL')).toHaveValue(newer);
  await page.getByRole('button', { name: 'Close schema settings' }).click();
  await page.reload();
  await expect(run(page)).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await expect(page.getByLabel('Schema definition SQL')).toHaveValue(newer);
});
