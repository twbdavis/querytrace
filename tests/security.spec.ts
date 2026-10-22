import { expect, test, type Page } from '@playwright/test';

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function buildSchema(page: Page, ddl: string) {
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(ddl);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.react-flow')).toHaveAttribute('data-layout-ready', 'true');
}

async function endpointProblems(page: Page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('.react-flow__node')];
    const problems: string[] = [];
    for (const connection of document.querySelectorAll('.key-connection')) {
      const path = connection.querySelector<SVGPathElement>('.react-flow__edge-path');
      const matrix = path?.getScreenCTM();
      const labels = connection.querySelector('title')?.textContent?.split(' → ');
      if (!path || !matrix || labels?.length !== 2) { problems.push('Missing wire geometry'); continue; }
      const points = [...(path.getAttribute('d') ?? '').matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)]
        .map((match) => new DOMPoint(Number(match[1]), Number(match[2])).matrixTransform(matrix));
      for (const [index, label] of labels.entries()) {
        const separator = label.lastIndexOf('.');
        const node = nodes.find((candidate) => candidate.dataset.id === label.slice(0, separator));
        const header = [...(node?.querySelectorAll<HTMLElement>('[data-column]') ?? [])]
          .find((candidate) => candidate.dataset.column === label.slice(separator + 1));
        if (!node || !header || points.length < 2) { problems.push(`Missing endpoint ${label}`); continue; }
        const bounds = node.getBoundingClientRect();
        const column = header.getBoundingClientRect();
        const point = index ? points.at(-1)! : points[0];
        const side = connection.getAttribute(index ? 'data-target-side' : 'data-source-side');
        if (Math.abs(point.x - (column.left + column.right) / 2) > 2 ||
          Math.abs(point.y - (side === 'top' ? bounds.top : bounds.bottom)) > 2) problems.push(`Detached endpoint ${label}`);
      }
    }
    return problems;
  });
}

test('quoted, bracketed and backslash identifiers remain measurable with valid foreign-key wires', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  const names = ['quoted"parent', 'bracket[parent]', 'back\\slash'];
  const ddl = names.map((name, index) => `CREATE TABLE ${quote(name)} (id INTEGER PRIMARY KEY${index ? `, parent_id INTEGER REFERENCES ${quote(names[index - 1])}(id)` : ''});
INSERT INTO ${quote(name)} VALUES (1${index ? ', 1' : ''});`).join('\n');
  await buildSchema(page, ddl);
  for (const name of names) await expect(page.getByTestId(`rf__node-${name}`)).toBeVisible();
  await expect(page.locator('.key-connection')).toHaveCount(2);
  await expect.poll(() => endpointProblems(page)).toEqual([]);
  // Rebuilding the same identifiers runs another handle measurement cycle.
  await buildSchema(page, ddl);
  await expect(page.locator('.key-connection')).toHaveCount(2);
  await expect.poll(() => endpointProblems(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('SQL values, column names and schema errors render HTML payloads as inert text', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  const payload = '<img src="x" onerror="window.__qtInjected=true"><svg onload="window.__qtInjected=true"></svg><script>window.__qtInjected=true</script>';
  const column = '<img src=x onerror=window.__qtInjected=true>';
  await buildSchema(page, `CREATE TABLE markup_probe (id INTEGER PRIMARY KEY, ${quote(column)} TEXT); INSERT INTO markup_probe VALUES (1, ${literal(payload)});`);
  const table = page.getByTestId('rf__node-markup_probe');
  await expect(table).toContainText(payload);
  await expect(table.locator('[data-column]').last()).toContainText(column);
  await expect(table.locator('img, script, svg')).toHaveCount(0);
  await page.getByLabel('SQL query editor').fill('SELECT * FROM markup_probe;');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await page.getByRole('tab').last().click();
  const result = page.getByRole('table', { name: 'Query results' });
  await expect(result).toContainText(payload);
  await expect(result.locator('img, script, svg')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(`CREATE TABLE invalid_markup (${quote(column)} TEXT, ${quote(column)} TEXT);`);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  const alert = page.getByRole('dialog').getByRole('alert');
  await expect(alert).toContainText('duplicate column name');
  await expect(alert).toContainText(column);
  await expect(alert.locator('img, script, svg')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __qtInjected?: boolean }).__qtInjected)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('production pages and assets carry isolation and content security headers without secret-file routes', async ({ request }) => {
  const response = await request.get('/trace');
  expect(response.ok()).toBe(true);
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
  expect(headers['content-security-policy']).not.toContain("'unsafe-eval'");
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
  expect(headers['cross-origin-resource-policy']).toBe('same-origin');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['strict-transport-security']).toContain('max-age=63072000');
  for (const path of ['/icon.svg', '/fonts/switzer-400.woff2']) {
    const asset = await request.get(path);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()['cross-origin-resource-policy']).toBe('same-origin');
    expect(asset.headers()['x-content-type-options']).toBe('nosniff');
  }
  for (const path of ['/.env', '/package-lock.json', '/SECURITY.md', '/.git/config', '/landing/hero-join.png']) {
    expect((await request.get(path)).status()).toBe(404);
  }
});
