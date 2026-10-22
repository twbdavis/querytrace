import { expect, test, type Page } from '@playwright/test';

type MutationGate = {
  held: boolean;
  acknowledged: boolean;
  release: () => void;
};
type GateWindow = Window & { lessonMutationGate?: MutationGate };

const run = (page: Page) => page.getByRole('button', { name: 'RUN', exact: true }).first();
const errors = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
const observerQuery = "SELECT CONCAT(GIVEN_NAME, ' ', FAMILY_NAME) AS 'Observer' FROM ASTRONOMER;";
const originalObservers = ['Mina Solberg', 'Caleb Nwosu', 'Yara Ito', 'Jonas Vale', 'Esme Rios', 'Dev Banerjee'];

async function openWithMutationGate(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    let heldRequestId: number | undefined;
    let sendHeldRequest: (() => void) | undefined;
    const gate: MutationGate = {
      held: false,
      acknowledged: false,
      release() {
        if (!sendHeldRequest) throw new Error('No SQL mutation is waiting at the gate.');
        const send = sendHeldRequest;
        sendHeldRequest = undefined;
        send();
      },
    };
    (window as GateWindow).lessonMutationGate = gate;
    // Hold only the first UPDATE request. Its SQL, actual worker execution,
    // response and persistence stay intact; the test controls when it starts.
    window.Worker = class extends OriginalWorker {
      private sqlWorker = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.sqlWorker = options?.name === 'querytrace-sql';
        if (this.sqlWorker) {
          this.addEventListener('message', (event) => {
            if (event.data?.id === heldRequestId) gate.acknowledged = event.data.ok === true;
          });
        }
      }
      postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        const request = message as { id?: number; operation?: string; sql?: string };
        const send = () => {
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options ?? {});
        };
        if (this.sqlWorker && !gate.held && request.operation === 'runQuery' && /^UPDATE\b/i.test(request.sql ?? '')) {
          heldRequestId = request.id;
          sendHeldRequest = send;
          gate.held = true;
        } else send();
      }
    };
  });
  await page.goto('/trace');
  // Cold WASM startup can outlast the default assertion timeout under load.
  // Wait for actual readiness before starting the controlled ordering race.
  await expect(run(page)).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId('rf__node-ASTRONOMER')).toContainText('Mina');
}

async function holdMutation(page: Page) {
  await page.getByLabel('SQL query editor').fill("UPDATE ASTRONOMER SET GIVEN_NAME='MUTATED';");
  await run(page).click();
  await expect.poll(() => page.evaluate(() => (window as GateWindow).lessonMutationGate?.held)).toBe(true);
}

async function releaseMutation(page: Page) {
  await page.evaluate(() => (window as GateWindow).lessonMutationGate!.release());
  await expect.poll(() => page.evaluate(() => (window as GateWindow).lessonMutationGate?.acknowledged)).toBe(true);
}

async function expectEditor(page: Page, sql: string) {
  // Desktop uses CodeMirror; the touch layout uses a textarea.
  await expect.poll(() => page.getByLabel('SQL query editor').evaluate((element) =>
    element instanceof HTMLTextAreaElement ? element.value : element.textContent,
  )).toBe(sql);
}

for (const action of ['Run lesson', 'Load query'] as const) {
  test(`${action} restores original lesson data after an already pending edit`, async ({ page }) => {
    await openWithMutationGate(page);
    await holdMutation(page);
    await page.getByRole('button', { name: 'Open lessons', exact: true }).click();
    const name = action === 'Run lesson'
      ? 'Run lesson: 7. Label a combined text field'
      : 'Load lesson into editor: 7. Label a combined text field';
    await page.getByRole('button', { name, exact: true }).click();
    await releaseMutation(page);
    await expect(page.getByRole('dialog', { name: 'Lessons' })).toBeHidden();
    await expectEditor(page, observerQuery);
    if (action === 'Load query') await run(page).click();
    const finalStage = page.getByRole('tab', { name: /SELECT .*Observer.*6 rows/ });
    await expect(finalStage).toBeVisible();
    await finalStage.click();
    const result = page.getByRole('table', { name: 'Query results' });
    await expect(result.getByRole('columnheader')).toHaveText(['Observer']);
    await expect(result.getByRole('cell')).toHaveText(originalObservers);
    await expect(errors(page)).toHaveCount(0);
  });
}

test('an older saved-schema resume cannot replace a later lesson choice', async ({ page }) => {
  await openWithMutationGate(page);
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill('CREATE TABLE custom_probe(id INTEGER PRIMARY KEY); INSERT INTO custom_probe VALUES(1);');
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog', { name: 'Schema' })).toBeHidden();
  await expect(page.getByTestId('rf__node-custom_probe')).toBeAttached();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByRole('button', { name: /Night observatory/ }).click();
  await expect(page.getByRole('dialog', { name: 'Schema' })).toBeHidden();

  await holdMutation(page);
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByRole('button', { name: 'RESUME SAVED SCHEMA' }).click();
  await page.getByRole('button', { name: 'Close schema settings' }).click();
  await page.getByRole('button', { name: 'Open lessons', exact: true }).click();
  await page.getByRole('button', { name: 'Run lesson: 1. Choose result columns', exact: true }).click();
  await releaseMutation(page);

  await expect(page.getByRole('dialog', { name: 'Lessons' })).toBeHidden();
  await expectEditor(page, 'SELECT ROUTE_NAME, ROUTE_CODE FROM FERRY_ROUTE;');
  await expect(page.getByTestId('rf__node-FERRY_ROUTE')).toBeAttached();
  await expect(page.getByTestId('rf__node-custom_probe')).toHaveCount(0);
  const finalStage = page.getByRole('tab', { name: /SELECT .*ROUTE_NAME.*ROUTE_CODE.*10 rows/ });
  await expect(finalStage).toBeVisible();
  await finalStage.click();
  const result = page.getByRole('table', { name: 'Query results' });
  await expect(result.getByRole('columnheader')).toHaveText(['ROUTE_NAME', 'ROUTE_CODE']);
  await expect(result.locator('[data-result-row]')).toHaveCount(10);
  await expect(result.locator('[data-result-row]').first().getByRole('cell')).toHaveText(['Bay Loop', 'B01']);
  await expect(errors(page)).toHaveCount(0);
});
