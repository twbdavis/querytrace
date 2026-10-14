import { expect, test, type Page } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) await page.screenshot({ path: testInfo.outputPath('schema-layout.png') });
});

const importedNames = Array.from({ length: 8 }, (_, index) => `layout_table_${index}`);
const importedColumns = [12, 8, 14, 10, 14, 9, 12, 8];

function tableDefinition(name: string, columnCount: number, parent?: string) {
  const columns = ['id INTEGER PRIMARY KEY', `parent_id INTEGER${parent ? ` REFERENCES ${parent}(id)` : ''}`];
  for (let column = 2; column < columnCount; column++) columns.push(`attribute_${column} TEXT`);
  return `CREATE TABLE ${name} (${columns.join(', ')});`;
}

function tableRows(name: string, columnCount: number, rowCount = 32, parent = false) {
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const id = index + 1;
    const values: Array<string | number> = [id, parent ? id : 'NULL'];
    for (let column = 2; column < columnCount; column++) values.push(`'${name} row ${id} descriptive value ${column}'`);
    return `(${values.join(', ')})`;
  });
  return `INSERT INTO ${name} VALUES ${rows.join(', ')};`;
}

const wideSchema = importedNames.map((name, index) =>
  tableDefinition(name, importedColumns[index], index ? importedNames[index - 1] : undefined)
  + tableRows(name, importedColumns[index], 32, index > 0)
).join('\n');

async function buildSchema(page: Page, sql: string, tableNames: string[]) {
  await page.getByRole('button', { name: 'Open schema settings' }).click();
  await page.getByLabel('Schema definition SQL').fill(sql);
  await page.getByRole('button', { name: 'BUILD THIS SCHEMA' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.react-flow__node-table')).toHaveCount(tableNames.length);
  for (const name of tableNames) await expect(page.getByTestId(`rf__node-${name}`)).toBeAttached();
}

/** Geometry comes from rendered tables and SVG paths, independent of the layout algorithm. */
async function layoutProblems(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const tolerance = 0.5;
    const nodes = [...document.querySelectorAll<HTMLElement>('.react-flow__node-table')].map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (style.opacity !== '1' || style.visibility !== 'visible') problems.push(`${node.getAttribute('data-testid')} is hidden`);
      return { node, name: node.getAttribute('data-testid')?.replace('rf__node-', '') ?? '',
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    });
    for (const node of nodes) if (node.width <= 0 || node.height <= 0) problems.push(`${node.name} has no measured bounds`);
    for (let first = 0; first < nodes.length; first++) {
      for (let second = first + 1; second < nodes.length; second++) {
        const a = nodes[first];
        const b = nodes[second];
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > tolerance && overlapY > tolerance) problems.push(`${a.name} overlaps ${b.name}: ${overlapX.toFixed(1)} x ${overlapY.toFixed(1)} px`);
      }
    }

    for (const connection of document.querySelectorAll('.key-connection')) {
      const path = connection.querySelector<SVGPathElement>('.react-flow__edge-path');
      const matrix = path?.getScreenCTM();
      const label = connection.querySelector('title')?.textContent ?? 'unknown connection';
      const data = path?.getAttribute('d') ?? '';
      if (!path || !matrix || !data) { problems.push(`${label} has no measured path`); continue; }
      if (/[CQAST]/.test(data)) { problems.push(`${label} is not an orthogonal path`); continue; }
      const points = [...data.matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)].map((match) =>
        new DOMPoint(Number(match[1]), Number(match[2])).matrixTransform(matrix)
      );
      if (points.length < 2) { problems.push(`${label} has no path segments`); continue; }
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1];
        const b = points[index];
        const horizontal = Math.abs(a.y - b.y) < tolerance;
        const vertical = Math.abs(a.x - b.x) < tolerance;
        if (!horizontal && !vertical) problems.push(`${label} has a diagonal segment`);
        for (const node of nodes) {
          const throughHorizontal = horizontal && a.y > node.top + tolerance && a.y < node.bottom - tolerance
            && Math.min(a.x, b.x) < node.right - tolerance && Math.max(a.x, b.x) > node.left + tolerance;
          const throughVertical = vertical && a.x > node.left + tolerance && a.x < node.right - tolerance
            && Math.min(a.y, b.y) < node.bottom - tolerance && Math.max(a.y, b.y) > node.top + tolerance;
          if (throughHorizontal || throughVertical) problems.push(`${label} segment ${index} crosses ${node.name}`);
        }
      }
      const ends = label.split(' → ');
      for (const [index, end] of ends.entries()) {
        const separator = end.lastIndexOf('.');
        const table = end.slice(0, separator);
        const column = end.slice(separator + 1);
        const node = nodes.find((candidate) => candidate.name === table);
        const header = node?.node.querySelector<HTMLElement>(`[data-column="${column}"]`);
        if (!node || !header) { problems.push(`${label} names a stale table or column`); continue; }
        const rect = header.getBoundingClientRect();
        const point = index ? points.at(-1)! : points[0];
        const side = connection.getAttribute(index ? 'data-target-side' : 'data-source-side');
        const expectedY = side === 'top' ? node.top : node.bottom;
        if (Math.abs(point.x - (rect.left + rect.right) / 2) > 2 || Math.abs(point.y - expectedY) > 2) {
          problems.push(`${label} endpoint ${index} is detached from its column border`);
        }
      }
    }
    return problems;
  });
}

async function expectClearLayout(page: Page, tables: number, connections: number) {
  await expect(page.locator('.react-flow__node-table')).toHaveCount(tables);
  await expect(page.locator('.key-connection')).toHaveCount(connections);
  await expect(page.locator('.react-flow')).toHaveAttribute('data-layout-ready', 'true');
  await expect(page.locator('.react-flow__nodes')).toHaveCSS('opacity', '1');
  if (connections) await expect(page.locator('.react-flow__edges').first()).toHaveCSS('opacity', '1');
  await expect.poll(() => layoutProblems(page), { message: 'tables do not overlap and key wires stay outside table interiors', timeout: 10_000 }).toEqual([]);
}

async function expectTablesWithinCanvas(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector('.react-flow')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.react-flow__node-table')].flatMap((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left < canvas.left - 1 || rect.right > canvas.right + 1 || rect.top < canvas.top - 1 || rect.bottom > canvas.bottom + 1
        ? [`${node.getAttribute('data-testid')} is clipped: (${rect.left.toFixed(1)}, ${rect.top.toFixed(1)})–(${rect.right.toFixed(1)}, ${rect.bottom.toFixed(1)})`]
        : [];
    });
  }), { message: 'the fitted viewport contains every imported table', timeout: 10_000 }).toEqual([]);
}

async function sharedTrunkProblems(page: Page) {
  return page.locator('.key-connection').evaluateAll((connections) => {
    const tolerance = 0.01;
    const wires = connections.map((connection) => ({
      label: connection.querySelector('title')?.textContent ?? '',
      points: [...(connection.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? '').matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)]
        .map((match) => ({ x: Number(match[1]), y: Number(match[2]) })),
    }));
    const problems: string[] = [];
    for (let first = 0; first < wires.length; first++) {
      for (let second = first + 1; second < wires.length; second++) {
        const a = wires[first];
        const b = wires[second];
        for (let ai = 1; ai < a.points.length; ai++) {
          for (let bi = 1; bi < b.points.length; bi++) {
            const a0 = a.points[ai - 1]; const a1 = a.points[ai];
            const b0 = b.points[bi - 1]; const b1 = b.points[bi];
            const horizontal = Math.abs(a0.y - a1.y) < tolerance && Math.abs(b0.y - b1.y) < tolerance && Math.abs(a0.y - b0.y) < tolerance;
            const vertical = Math.abs(a0.x - a1.x) < tolerance && Math.abs(b0.x - b1.x) < tolerance && Math.abs(a0.x - b0.x) < tolerance;
            if (!horizontal && !vertical) continue;
            const axis = horizontal ? 'x' : 'y';
            const overlap = Math.min(Math.max(a0[axis], a1[axis]), Math.max(b0[axis], b1[axis]))
              - Math.max(Math.min(a0[axis], a1[axis]), Math.min(b0[axis], b1[axis]));
            if (overlap <= tolerance) continue;
            // Common ports may share the short exit/entry stem. Longer trunks
            // must remain distinguishable regardless of canvas zoom; allow
            // the same short branching pieces immediately beside that stem.
            if (overlap <= 16) continue;
            problems.push(`${a.label} and ${b.label} share ${overlap.toFixed(1)} world px on segments ${ai}/${bi}`);
          }
        }
      }
    }
    return problems;
  });
}

async function columnDistribution(page: Page) {
  return page.getByTestId('rf__node-redistributed_parent').evaluate((element) => {
    const node = element as HTMLElement;
    const rect = node.getBoundingClientRect();
    const key = node.querySelector<HTMLElement>('[data-column="id"]')!.getBoundingClientRect();
    return { width: node.offsetWidth, anchor: ((key.left + key.right) / 2 - rect.left) * node.offsetWidth / rect.width };
  });
}

async function runCreate(page: Page, sql: string, tableName: string) {
  await page.getByLabel('SQL query editor').fill(sql);
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await expect(page.getByRole('tab', { name: new RegExp(`CREATE TABLE ${tableName}`) })).toBeVisible();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
  await expect(page.getByTestId(`rf__node-${tableName}`)).toBeAttached();
}

test('wide imported tables and newly created custom tables have clear bounds and key wires', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await buildSchema(page, wideSchema, importedNames);
  await expect(page.getByTestId('rf__node-layout_table_2').locator('[data-column]')).toHaveCount(14);
  await expect(page.getByTestId('rf__node-layout_table_2').locator('[data-table-row]')).toHaveCount(32);
  await expectClearLayout(page, 8, 7);
  await expectTablesWithinCanvas(page);
  await page.screenshot({ path: testInfo.outputPath('wide-import.png') });

  const positions = () => page.locator('.react-flow__node-table').evaluateAll((nodes) => nodes.map((node) => ({ id: node.getAttribute('data-testid'), position: (node as HTMLElement).style.transform })));
  const beforeQueries = await positions();
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.getByLabel('SQL query editor').fill('SELECT id FROM layout_table_0 WHERE id <= 2 ORDER BY id;');
    await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
    await expect(page.getByRole('tab').last()).toBeVisible();
    await page.getByRole('tab').last().click();
    await expect.poll(positions).toEqual(beforeQueries);
    await expectClearLayout(page, 8, 7);
  }

  const expandedValues: Array<string | number> = [33, 'NULL'];
  for (let column = 2; column < importedColumns[0]; column++) expandedValues.push(`'${column === 2 ? 'expanded imported value '.repeat(8) : `new value ${column}`}'`);
  await page.getByLabel('SQL query editor').fill(`INSERT INTO layout_table_0 VALUES (${expandedValues.join(', ')});`);
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await expect(page.getByRole('tab').last()).toBeVisible();
  await page.getByRole('tab').last().click();
  await expect(page.getByTestId('rf__node-layout_table_0').locator('[data-table-row]')).toHaveCount(33);
  await expectClearLayout(page, 8, 7);

  await runCreate(page, tableDefinition('layout_added', 14, 'layout_table_7'), 'layout_added');
  await expectClearLayout(page, 9, 8);
});

test('column redistribution refreshes key anchors even when the total table width stays constant', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await buildSchema(page, `
    CREATE TABLE redistributed_parent (left_value TEXT, id INTEGER PRIMARY KEY, right_value TEXT);
    CREATE TABLE redistributed_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES redistributed_parent(id));
    INSERT INTO redistributed_parent VALUES ('${'L'.repeat(100)}', 1, '${'R'.repeat(40)}');
    INSERT INTO redistributed_child VALUES (1, 1);
  `, ['redistributed_parent', 'redistributed_child']);
  await expectClearLayout(page, 2, 1);
  const before = await columnDistribution(page);
  await page.getByLabel('SQL query editor').fill('UPDATE redistributed_parent SET left_value = right_value, right_value = left_value WHERE id = 1;');
  await page.getByRole('button', { name: 'RUN', exact: true }).first().click();
  await expect(page.getByRole('tab').last()).toBeVisible();
  await page.getByRole('tab').last().click();
  await expect.poll(async () => Math.abs((await columnDistribution(page)).anchor - before.anchor)).toBeGreaterThan(100);
  const after = await columnDistribution(page);
  expect(Math.abs(after.width - before.width), 'the fixture changes internal columns without resizing the card').toBeLessThanOrEqual(1);
  await expectClearLayout(page, 2, 1);
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.getByRole('tab').first().click();
    await expect.poll(async () => Math.abs((await columnDistribution(page)).anchor - before.anchor)).toBeLessThan(1);
    await expectClearLayout(page, 2, 1);
    await page.getByRole('tab').last().click();
    await expect.poll(async () => Math.abs((await columnDistribution(page)).anchor - after.anchor)).toBeLessThan(1);
    await expectClearLayout(page, 2, 1);
  }
});

test('high fanout key wires remain distinct outside short shared endpoint stems', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const children = Array.from({ length: 12 }, (_, index) => `fanout_child_${index}`);
  const ddl = `CREATE TABLE fanout_parent (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO fanout_parent VALUES (1, 'hub');\n`
    + children.map((name) => `CREATE TABLE ${name} (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES fanout_parent(id), label TEXT); INSERT INTO ${name} VALUES (1, 1, '${name}');`).join('\n');
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await buildSchema(page, ddl, ['fanout_parent', ...children]);
  await expectClearLayout(page, 13, 12);
  await expect.poll(() => sharedTrunkProblems(page), { message: 'high fanout wires have no shared trunks', timeout: 10_000 }).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('high-fanout.png') });
});

test('foreign keys referencing UNIQUE columns have measured source handles without false PK badges', async ({ page }) => {
  test.setTimeout(45_000);
  const handleWarnings: string[] = [];
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()) && /source handle|target handle|couldn.t create edge|reactflow\.dev\/error#008/i.test(message.text())) {
      handleWarnings.push(message.text());
    }
  });
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await buildSchema(page, `
    CREATE TABLE unique_parent (id INTEGER PRIMARY KEY, code TEXT UNIQUE);
    CREATE TABLE unique_child (id INTEGER PRIMARY KEY, parent_code TEXT REFERENCES unique_parent(code));
    INSERT INTO unique_parent VALUES (1, 'ALPHA'), (2, 'BETA');
    INSERT INTO unique_child VALUES (1, 'ALPHA'), (2, 'BETA');
  `, ['unique_parent', 'unique_child']);
  await expect(page.locator('.key-connection title')).toHaveText('unique_parent.code → unique_child.parent_code');
  await expectClearLayout(page, 2, 1);
  const uniqueColumn = page.getByTestId('rf__node-unique_parent').locator('[data-column="code"]');
  await expect(uniqueColumn.getByText('PK', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('rf__node-unique_parent').locator('[data-column="id"]').getByText('PK', { exact: true })).toHaveCount(1);

  // Reload the parent without any incoming reference, then introduce its
  // UNIQUE source handle through live CREATE. The new name sorts first but
  // must not displace the established card when that card's size is stable.
  await buildSchema(page, `CREATE TABLE unique_parent (id INTEGER PRIMARY KEY, code TEXT UNIQUE);
    INSERT INTO unique_parent VALUES (1, 'ALPHA'), (2, 'BETA');`, ['unique_parent']);
  await expectClearLayout(page, 1, 0);
  const parentGeometry = () => page.getByTestId('rf__node-unique_parent').evaluate((element) => {
    const node = element as HTMLElement;
    return { position: node.style.transform, width: node.offsetWidth, height: node.offsetHeight };
  });
  const beforeCreate = await parentGeometry();
  await runCreate(page, 'CREATE TABLE aaa_child (id INTEGER PRIMARY KEY, parent_code TEXT REFERENCES unique_parent(code));', 'aaa_child');
  await expectClearLayout(page, 2, 1);
  await expect(page.locator('.key-connection title')).toHaveText('unique_parent.code → aaa_child.parent_code');
  await expect.poll(parentGeometry).toEqual(beforeCreate);
  await expect(page.getByTestId('rf__node-unique_parent').locator('[data-column="code"]').getByText('PK', { exact: true })).toHaveCount(0);
  expect(handleWarnings, 'import and live CREATE produce no missing-handle warnings').toEqual([]);
});

test('rebuilding the same table names refreshes column sizes and foreign-key endpoints', async ({ page }) => {
  test.setTimeout(60_000);
  const names = ['reload_parent_a', 'reload_parent_b', 'reload_child'];
  const parents = names.slice(0, 2).map((name) => tableDefinition(name, 2) + tableRows(name, 2)).join('\n');
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await buildSchema(page, parents + tableDefinition('reload_child', 4, 'reload_parent_a') + tableRows('reload_child', 4, 32, true), names);
  await expect(page.locator('.key-connection title')).toHaveText('reload_parent_a.id → reload_child.parent_id');
  await expectClearLayout(page, 3, 1);

  await buildSchema(page, parents + tableDefinition('reload_child', 14, 'reload_parent_b') + tableRows('reload_child', 14, 32, true), names);
  await expect(page.getByTestId('rf__node-reload_child').locator('[data-column]')).toHaveCount(14);
  await expect(page.locator('.key-connection title')).toHaveText('reload_parent_b.id → reload_child.parent_id');
  await expectClearLayout(page, 3, 1);
});

test('CREATE adds a wide related table to a bundled schema without covering existing tables', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'RUN', exact: true }).first()).toBeEnabled();
  await expectClearLayout(page, 4, 3);
  const columns = ['id INTEGER PRIMARY KEY', 'astronomer_id INTEGER REFERENCES ASTRONOMER(ASTRONOMER_ID)'];
  for (let column = 2; column < 14; column++) columns.push(`long_added_attribute_${column} VARCHAR(100)`);
  await runCreate(page, `CREATE TABLE builtin_added (${columns.join(', ')});`, 'builtin_added');
  await expect(page.getByTestId('rf__node-builtin_added').locator('[data-column]')).toHaveCount(14);
  await expectClearLayout(page, 5, 4);
});
