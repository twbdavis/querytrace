import { expect, test } from '@playwright/test';

test('large results keep a bounded DOM and preserve row tracing across scroll windows', async ({ page }) => {
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(`
    CREATE TABLE PERF_ROW (ID INTEGER PRIMARY KEY, LABEL TEXT);
    INSERT INTO PERF_ROW VALUES ${Array.from({ length: 500 }, (_, i) => `(${i + 1}, 'Row ${i + 1}')`).join(',')};
  `);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const canvasTable = page.getByTestId('rf__node-PERF_ROW');
  expect(await canvasTable.locator('[data-table-row]').count()).toBeLessThanOrEqual(81);
  const canvasWidth = await canvasTable.evaluate((element) => (element as HTMLElement).offsetWidth);
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await page.getByRole('tab').last().click();
  const result = page.getByRole('table', { name: 'Query results' });
  await expect(result).toHaveAttribute('aria-rowcount', '501');
  expect(await result.locator('[data-result-row]').count()).toBeLessThan(80);
  const scroll = page.locator('[data-result-scroll]');
  const beforeWidth = await result.boundingBox();
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const last = result.locator('[data-result-row="499"]');
  await expect(last).toBeVisible();
  await expect(last).toHaveAttribute('aria-rowindex', '501');
  await expect(last).toContainText('Row 500');
  await last.click();
  await expect(page.getByText(/tracing PERF_ROW · ID 500/)).toBeVisible();
  await expect(canvasTable.locator('[data-table-row="500"]')).toBeVisible();
  const selectedCell = await canvasTable.locator('[data-table-row="500"] > div').first().boundingBox();
  const canvasBounds = await page.locator('.react-flow').boundingBox();
  expect(selectedCell!.y).toBeGreaterThanOrEqual(canvasBounds!.y);
  expect(selectedCell!.y + selectedCell!.height).toBeLessThanOrEqual(canvasBounds!.y + canvasBounds!.height);
  expect(selectedCell!.x).toBeGreaterThanOrEqual(canvasBounds!.x);
  expect(selectedCell!.x + selectedCell!.width).toBeLessThanOrEqual(canvasBounds!.x + canvasBounds!.width);
  expect(await canvasTable.locator('[data-table-row]').count()).toBeLessThanOrEqual(81);
  expect(await canvasTable.evaluate((element) => (element as HTMLElement).offsetWidth)).toBe(canvasWidth);
  expect((await result.boundingBox())?.width).toBeCloseTo(beforeWidth!.width, 0);
  expect(await result.locator('[data-result-row]').count()).toBeLessThan(80);

  // Scrubbing must replace the old window and clear transient row indices.
  await page.getByRole('button', { name: 'Reset to first stage' }).click();
  await expect(result.locator('[data-result-row="0"]')).toBeVisible();
  await expect(page.getByText(/tracing PERF_ROW/)).toBeHidden();
});

test('wide canvas cards keep a bounded row DOM while retaining their full data', async ({ page }) => {
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  const fields = Array.from({ length: 39 }, (_, i) => `c${i} INTEGER`).join(',');
  const tuples = Array.from({ length: 500 }, (_, i) => `(${[i + 1, ...Array(39).fill(1)].join(',')})`).join(',');
  await page.getByLabel('Schema definition SQL').fill(`CREATE TABLE PERF_WIDE (id INTEGER PRIMARY KEY, ${fields}); INSERT INTO PERF_WIDE VALUES ${tuples};`);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const card = page.getByTestId('rf__node-PERF_WIDE');
  await expect(card).toContainText('500 rows');
  expect(await card.locator('[data-table-row]').count()).toBeLessThanOrEqual(81);
  expect(await card.locator('[data-table-spacer]').count()).toBeGreaterThan(0);
  expect(await card.locator('[data-table-row] > div').count()).toBeLessThanOrEqual(81 * 40);
  await page.getByLabel('SQL query editor').fill('SELECT id FROM PERF_WIDE ORDER BY id DESC');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await page.getByRole('tab').last().click();
  await page.locator('[data-result-row="0"]').click();
  await expect(card.locator('[data-table-row="500"]')).toBeVisible();
  expect(await card.locator('[data-table-row]').count()).toBeLessThanOrEqual(81);
});

test('a dense overview shares one canvas cell budget across all cards', async ({ page }) => {
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  const columns = ['id INTEGER PRIMARY KEY', ...Array.from({ length: 19 }, (_, i) => `c${i} INTEGER`)];
  const rows = Array.from({ length: 60 }, (_, i) => `(${[i + 1, ...Array(19).fill(1)].join(',')})`).join(',');
  await page.getByLabel('Schema definition SQL').fill(Array.from({ length: 24 }, (_, i) => `CREATE TABLE PERF_SCENE_${i}(${columns}); INSERT INTO PERF_SCENE_${i} VALUES ${rows};`).join('\n'));
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.react-flow')).toHaveAttribute('data-layout-ready', 'true');
  await expect(page.locator('.react-flow__node')).toHaveCount(24);
  expect(await page.locator('[data-table-row] > div').count()).toBeLessThanOrEqual(8_000);
  await expect(page.getByTestId('rf__node-PERF_SCENE_23')).toContainText('60 rows');
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    for (let i = 0; i < 5; i++) await page.locator('.react-flow__controls-zoomin').click();
    expect(await page.locator('[data-table-row] > div').count()).toBeLessThanOrEqual(8_000);
  }
});

test('hidden Unicode values preserve canvas column widths when selected', async ({ page }, testInfo) => {
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  const rows = Array.from({ length: 500 }, (_, i) => `(${i + 1}, '${i === 499 ? '界'.repeat(50) : 'A'.repeat(51)}')`).join(',');
  await page.getByLabel('Schema definition SQL').fill(`CREATE TABLE PERF_UNICODE(id INTEGER PRIMARY KEY, label TEXT); INSERT INTO PERF_UNICODE VALUES ${rows};`);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.react-flow')).toHaveAttribute('data-layout-ready', 'true');
  const card = page.getByTestId('rf__node-PERF_UNICODE');
  const width = await card.evaluate((element) => (element as HTMLElement).offsetWidth);
  await page.getByLabel('SQL query editor').fill("SELECT id, label, 'AFTER' AS marker FROM PERF_UNICODE ORDER BY id DESC");
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await page.getByRole('tab').last().click();
  const overlap = await page.locator('[data-result-row="0"]').evaluate((row) => {
    const range = document.createRange();
    range.selectNodeContents(row.children[1]);
    return range.getBoundingClientRect().right > row.children[2].getBoundingClientRect().left + 0.5;
  });
  expect(overlap, 'wide fallback glyphs fit their result column').toBe(false);
  await page.locator('[data-result-row="0"]').click();
  await expect(card.locator('[data-table-row="500"]')).toBeVisible();
  expect(await card.evaluate((element) => (element as HTMLElement).offsetWidth)).toBe(width);
  await page.screenshot({ path: testInfo.outputPath('unicode-row-selected.png') });
});

test('437 foreign keys route only after dense card measurements settle', async ({ page }) => {
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  const columns = ['id INTEGER PRIMARY KEY', ...Array.from({ length: 19 }, (_, i) => `c${i + 1} INTEGER`)];
  const values = `(${Array(20).fill(1).join(',')})`;
  const ddl = `CREATE TABLE PERF_HUB(${columns}); INSERT INTO PERF_HUB VALUES ${values};\n` + Array.from({ length: 23 }, (_, i) =>
    `CREATE TABLE PERF_CHILD_${i}(id INTEGER PRIMARY KEY, ${Array.from({ length: 19 }, (_, j) => `fk${j + 1} INTEGER REFERENCES PERF_HUB(id)`).join(',')}); INSERT INTO PERF_CHILD_${i} VALUES ${values};`).join('\n');
  await page.getByLabel('Schema definition SQL').fill(ddl);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('.react-flow')).toHaveAttribute('data-layout-ready', 'true');
  await expect(page.locator('.key-connection')).toHaveCount(437, { timeout: 15_000 });
  const geometry = await page.evaluate(() => {
    const zoom = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a;
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const boxes = nodes.map((node) => {
      const matrix = new DOMMatrix(getComputedStyle(node).transform);
      return { x: matrix.e, y: matrix.f, width: (node as HTMLElement).offsetWidth, height: (node as HTMLElement).offsetHeight };
    });
    let blocked = 0;
    let misaligned = 0;
    for (const connection of document.querySelectorAll('.key-connection')) {
      const path = connection.querySelector('.react-flow__edge-path') as SVGPathElement;
      const points = [...path.getAttribute('d')!.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({ x: +match[1], y: +match[2] }));
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]; const b = points[i];
        for (const box of boxes) {
          if (a.x === b.x ? a.x > box.x + 0.5 && a.x < box.x + box.width - 0.5 && Math.max(a.y, b.y) > box.y + 0.5 && Math.min(a.y, b.y) < box.y + box.height - 0.5
            : a.y > box.y + 0.5 && a.y < box.y + box.height - 0.5 && Math.max(a.x, b.x) > box.x + 0.5 && Math.min(a.x, b.x) < box.x + box.width - 0.5) blocked++;
        }
      }
      connection.querySelector('title')!.textContent!.split(' → ').forEach((label, i) => {
        const [table, column] = label.split('.');
        const node = nodes.find((candidate) => (candidate as HTMLElement).dataset.id === table)!;
        const cell = [...node.querySelectorAll('[data-column]')].find((candidate) => (candidate as HTMLElement).dataset.column === column)!;
        const rect = cell.getBoundingClientRect();
        const point = points[i ? points.length - 1 : 0];
        const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
        if (Math.abs(screen.x - (rect.left + rect.right) / 2) > Math.max(2, zoom)) misaligned++;
      });
    }
    return { blocked, misaligned };
  });
  expect(geometry).toEqual({ blocked: 0, misaligned: 0 });
});

test('join motion stops when paused and respects reduced motion', async ({ page }) => {
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  const editor = page.getByLabel('SQL query editor');
  await editor.fill('SELECT a.GIVEN_NAME FROM ASTRONOMER a JOIN OBSERVATION o ON a.ASTRONOMER_ID = o.ASTRONOMER_ID');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await expect(page.locator('.edge-pulse').first()).toBeAttached();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('.edge-pulse')).toHaveCount(0);
  await expect(page.locator('.bus-current')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const activeStage = await page.getByRole('tab', { selected: true }).getAttribute('aria-label');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.edge-pulse')).toHaveCount(0);
  await page.waitForTimeout(2200);
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('aria-label', activeStage!);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.edge-pulse').first()).toBeAttached();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('.edge-pulse')).toHaveCount(0);
  const moving = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' && (animation.effect?.getComputedTiming().duration as number) > 1).length);
  expect(moving).toBe(0);
});
