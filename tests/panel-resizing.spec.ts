import { expect, test, type Locator, type Page } from '@playwright/test';

class TracerPanels {
  readonly query: Locator;
  readonly results: Locator;
  readonly widthHandle: Locator;
  readonly splitHandle: Locator;

  constructor(readonly page: Page) {
    this.query = page.getByRole('region', { name: 'SQL editor panel', exact: true });
    this.results = page.getByRole('region', { name: 'Results panel', exact: true });
    this.widthHandle = page.getByRole('separator', { name: 'Resize query and results panels', exact: true });
    this.splitHandle = page.getByRole('separator', { name: 'Resize query and results split', exact: true });
  }

  async open() {
    await this.page.setViewportSize({ width: 1440, height: 960 });
    await this.page.goto('/trace');
    await expect(this.query).toBeVisible();
    await expect(this.results).toBeVisible();
    await expect(this.page.getByRole('button', { name: 'RUN', exact: true })).toBeEnabled();
  }

  async drag(handle: Locator, dx: number, dy: number, button: 'left' | 'right' = 'right') {
    await handle.hover();
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down({ button });
    await this.page.mouse.move(x + dx, y + dy, { steps: 10 });
    await this.page.mouse.up({ button });
  }

  async size(panel: Locator) {
    return (await panel.boundingBox())!;
  }
}

test.describe('desktop tracer panel resizing', () => {
  test.beforeEach(async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, 'Border resizing belongs to the desktop layout.');
  });

  test('right-button border dragging enlarges both panels and redistributes their height', async ({ page }) => {
    const panels = new TracerPanels(page);
    await panels.open();
    const initialQuery = await panels.size(panels.query);
    const initialResults = await panels.size(panels.results);
    await page.evaluate(() => {
      // Read cancellation after dispatch; capture-listener microtasks can run before React's handler.
      const contextMenus: Event[] = [];
      Reflect.set(window, 'panelResizeContextMenus', contextMenus);
      document.addEventListener('contextmenu', (event) => {
        contextMenus.push(event);
      }, true);
    });

    await panels.drag(panels.widthHandle, 220, 0);
    await expect.poll(async () => (await panels.size(panels.query)).width).toBeGreaterThan(initialQuery.width + 180);
    const expandedQuery = await panels.size(panels.query);
    const expandedResults = await panels.size(panels.results);
    expect(Math.abs(expandedQuery.width - expandedResults.width)).toBeLessThanOrEqual(1);

    // The grip owns this gesture, including the browser's context-menu event.
    for (const handle of [panels.widthHandle, panels.splitHandle]) {
      expect(await handle.evaluate((element) => element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
      })))).toBe(false);
    }

    await panels.drag(panels.splitHandle, 0, 110);
    await expect.poll(async () => (await panels.size(panels.query)).height).toBeGreaterThan(initialQuery.height + 80);
    const tallerQuery = await panels.size(panels.query);
    const shorterResults = await panels.size(panels.results);
    expect(shorterResults.height).toBeLessThan(initialResults.height - 80);
    expect(shorterResults.height).toBeGreaterThan(100);
    expect(Math.abs(tallerQuery.height + shorterResults.height - initialQuery.height - initialResults.height)).toBeLessThanOrEqual(2);

    await panels.drag(panels.splitHandle, 0, -180);
    await expect.poll(async () => (await panels.size(panels.results)).height).toBeGreaterThan(initialResults.height + 40);
    expect((await panels.size(panels.query)).height).toBeGreaterThan(100);
    expect(await page.evaluate(() => (Reflect.get(window, 'panelResizeContextMenus') as Event[])
      .map((event) => event.defaultPrevented))).not.toContain(false);
  });

  test('supports primary-button dragging and keyboard resizing without stepping playback', async ({ page }) => {
    const panels = new TracerPanels(page);
    await panels.open();
    const initialWidth = (await panels.size(panels.query)).width;
    await panels.drag(panels.widthHandle, 160, 0, 'left');
    await expect.poll(async () => (await panels.size(panels.query)).width).toBeGreaterThan(initialWidth + 120);

    await page.getByRole('button', { name: 'RUN', exact: true }).click();
    await expect(page.getByRole('tablist', { name: 'Execution stages' })).toBeVisible();
    const selectedStage = await page.getByRole('tab', { selected: true }).getAttribute('aria-label');
    const draggedWidth = (await panels.size(panels.query)).width;

    await panels.widthHandle.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await panels.size(panels.query)).width).toBeGreaterThan(draggedWidth);
    const keyboardWidth = (await panels.size(panels.query)).width;
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await panels.size(panels.query)).width).toBeLessThan(keyboardWidth);
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('aria-label', selectedStage!);

    const queryHeight = (await panels.size(panels.query)).height;
    await panels.splitHandle.focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await panels.size(panels.query)).height).toBeGreaterThan(queryHeight);
    const tallerHeight = (await panels.size(panels.query)).height;
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await panels.size(panels.query)).height).toBeLessThan(tallerHeight);
  });

  test('Fit View keeps every schema table beside an expanded sidebar', async ({ page }) => {
    const panels = new TracerPanels(page);
    await panels.open();
    const canvas = page.locator('[data-layout-ready]');
    const tables = ['ASTRONOMER', 'TELESCOPE', 'TARGET', 'OBSERVATION'].map((name) => page.getByTestId(`rf__node-${name}`));
    await expect(canvas).toHaveAttribute('data-layout-ready', 'true');
    for (const table of tables) await expect(table).toBeVisible();

    const initialWidth = (await panels.size(panels.query)).width;
    await panels.drag(panels.widthHandle, 600, 0);
    await expect.poll(async () => (await panels.size(panels.query)).width).toBeGreaterThan(initialWidth + 500);
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();

    await expect.poll(async () => {
      const sidebar = await panels.size(panels.query);
      const available = (await canvas.boundingBox())!;
      const bounds = await Promise.all(tables.map((table) => panels.size(table)));
      return bounds.flatMap((table, index) => table.x < sidebar.x + sidebar.width + 8
        || table.x + table.width > available.x + available.width + 1
        || table.y < available.y - 1
        || table.y + table.height > available.y + available.height + 1
        ? [`${index}: table overlaps the sidebar or extends outside the canvas`]
        : []);
    }, { message: 'Fit View places all measured tables in the uncovered canvas' }).toEqual([]);
  });

  test('restores custom panel dimensions after collapsing either or both panels', async ({ page }) => {
    const panels = new TracerPanels(page);
    await panels.open();
    await panels.drag(panels.widthHandle, 190, 0);
    await panels.drag(panels.splitHandle, 0, 80);
    const customQuery = await panels.size(panels.query);

    await page.getByRole('button', { name: 'Collapse query panel', exact: true }).click();
    await expect(panels.query).toBeHidden();
    await expect(panels.splitHandle).toBeHidden();
    await page.getByRole('button', { name: 'QUERY', exact: true }).click();
    await expect(panels.query).toBeVisible();
    expect(Math.abs((await panels.size(panels.query)).height - customQuery.height)).toBeLessThanOrEqual(2);

    await page.getByRole('button', { name: 'Collapse result panel', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse query panel', exact: true }).click();
    await expect(panels.widthHandle).toBeHidden();
    await page.getByRole('button', { name: 'RESULTS', exact: true }).click();
    await page.getByRole('button', { name: 'QUERY', exact: true }).click();
    await expect(panels.splitHandle).toBeVisible();
    const restoredQuery = await panels.size(panels.query);
    expect(Math.abs(restoredQuery.width - customQuery.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(restoredQuery.height - customQuery.height)).toBeLessThanOrEqual(2);
    expect(Math.abs((await panels.size(panels.results)).width - customQuery.width)).toBeLessThanOrEqual(2);
  });

  test('remembers the resized width and query/results heights after a refresh', async ({ page }) => {
    const panels = new TracerPanels(page);
    await panels.open();
    await panels.drag(panels.widthHandle, 190, 0);
    await panels.drag(panels.splitHandle, 0, 80);
    const customQuery = await panels.size(panels.query);
    const customResults = await panels.size(panels.results);

    await page.reload();
    await expect(page.getByRole('button', { name: 'RUN', exact: true })).toBeEnabled();
    for (const [panel, custom] of [[panels.query, customQuery], [panels.results, customResults]] as const) {
      await expect.poll(async () => {
        const restored = await panels.size(panel);
        return Math.max(Math.abs(restored.width - custom.width), Math.abs(restored.height - custom.height));
      }).toBeLessThanOrEqual(2);
    }
  });

  test('remembers each collapsed panel after refresh and remembers reopening it', async ({ page }) => {
    const panels = new TracerPanels(page);
    await panels.open();

    for (const [panel, sibling, collapse, restore] of [
      [panels.query, panels.results, 'Collapse query panel', 'QUERY'],
      [panels.results, panels.query, 'Collapse result panel', 'RESULTS'],
    ] as const) {
      await page.getByRole('button', { name: collapse, exact: true }).click();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Open schema settings', exact: true })).toBeEnabled();
      await expect(panel).toBeHidden();
      await expect(sibling).toBeVisible();
      await expect(panels.splitHandle).toBeHidden();

      await page.getByRole('button', { name: restore, exact: true }).click();
      await page.reload();
      await expect(page.getByRole('button', { name: 'RUN', exact: true })).toBeEnabled();
      await expect(panels.query).toBeVisible();
      await expect(panels.results).toBeVisible();
      await expect(panels.splitHandle).toBeVisible();
    }
  });

  test('keeps both panels collapsed across refresh without losing their custom sizes', async ({ page }) => {
    const panels = new TracerPanels(page);
    await panels.open();
    await panels.drag(panels.widthHandle, 190, 0);
    await panels.drag(panels.splitHandle, 0, 80);
    const customQuery = await panels.size(panels.query);
    const customResults = await panels.size(panels.results);

    await page.getByRole('button', { name: 'Collapse query panel', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse result panel', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open schema settings', exact: true })).toBeEnabled();
    await expect(panels.query).toBeHidden();
    await expect(panels.results).toBeHidden();
    await expect(panels.widthHandle).toBeHidden();

    await page.getByRole('button', { name: 'RESULTS', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open schema settings', exact: true })).toBeEnabled();
    await expect(panels.query).toBeHidden();
    await expect(panels.results).toBeVisible();
    await page.getByRole('button', { name: 'QUERY', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'RUN', exact: true })).toBeEnabled();
    await expect(panels.splitHandle).toBeVisible();

    for (const [panel, custom] of [[panels.query, customQuery], [panels.results, customResults]] as const) {
      await expect.poll(async () => {
        const restored = await panels.size(panel);
        return Math.max(Math.abs(restored.width - custom.width), Math.abs(restored.height - custom.height));
      }).toBeLessThanOrEqual(2);
    }
  });

  test('keeps saved dimensions and defaults panels open for missing or invalid collapsed preferences', async ({ page }) => {
    const panels = new TracerPanels(page);
    await panels.open();
    await panels.drag(panels.widthHandle, 190, 0);
    await panels.drag(panels.splitHandle, 0, 80);
    const customQuery = await panels.size(panels.query);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('querytrace.panel-layout.v1')!));

    for (const preferences of [{}, { queryOpen: 'false', resultsOpen: 0 }]) {
      await page.evaluate((value) => localStorage.setItem('querytrace.panel-layout.v1', JSON.stringify(value)), {
        width: saved.width,
        queryShare: saved.queryShare,
        ...preferences,
      });
      await page.reload();
      await expect(page.getByRole('button', { name: 'RUN', exact: true })).toBeEnabled();
      await expect(panels.query).toBeVisible();
      await expect(panels.results).toBeVisible();
      await expect.poll(async () => {
        const restored = await panels.size(panels.query);
        return Math.max(Math.abs(restored.width - customQuery.width), Math.abs(restored.height - customQuery.height));
      }).toBeLessThanOrEqual(2);
    }
  });

  test('refreshing a smaller viewport preserves the preferred dimensions for a larger viewport', async ({ page }) => {
    const panels = new TracerPanels(page);
    await panels.open();
    const initialQuery = await panels.size(panels.query);
    await panels.drag(panels.widthHandle, 600, 0);
    await expect.poll(async () => (await panels.size(panels.query)).width).toBeGreaterThan(initialQuery.width + 500);
    await panels.drag(panels.splitHandle, 0, 240);
    await expect.poll(async () => (await panels.size(panels.query)).height).toBeGreaterThan(initialQuery.height + 180);
    const customQuery = await panels.size(panels.query);
    const customResults = await panels.size(panels.results);

    await page.setViewportSize({ width: 1024, height: 600 });
    await page.reload();
    await expect(page.getByRole('button', { name: 'RUN', exact: true })).toBeEnabled();
    await expect.poll(async () => (await panels.size(panels.query)).width).toBeLessThan(customQuery.width);
    const smallerQuery = await panels.size(panels.query);
    const smallerResults = await panels.size(panels.results);
    expect(smallerQuery.height).toBeLessThan(customQuery.height);
    expect(smallerQuery.height).toBeGreaterThan(100);
    expect(smallerResults.height).toBeGreaterThan(100);
    expect(smallerResults.y + smallerResults.height).toBeLessThanOrEqual(600);

    await page.setViewportSize({ width: 1440, height: 960 });
    for (const [panel, custom] of [[panels.query, customQuery], [panels.results, customResults]] as const) {
      await expect.poll(async () => {
        const restored = await panels.size(panel);
        return Math.max(Math.abs(restored.width - custom.width), Math.abs(restored.height - custom.height));
      }).toBeLessThanOrEqual(2);
    }
  });

  test('ignores malformed or invalid saved dimensions and remains resizable', async ({ page }) => {
    const panels = new TracerPanels(page);
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    await panels.open();
    const defaults = await panels.size(panels.query);

    for (const saved of ['{', '{"width":-1,"queryShare":2}', '{"width":1e309,"queryShare":-1e309}']) {
      await page.evaluate((value) => localStorage.setItem('querytrace.panel-layout.v1', value), saved);
      await page.reload();
      await expect(page.getByRole('button', { name: 'RUN', exact: true })).toBeEnabled();
      await expect.poll(async () => {
        const restored = await panels.size(panels.query);
        return Math.max(Math.abs(restored.width - defaults.width), Math.abs(restored.height - defaults.height));
      }).toBeLessThanOrEqual(2);
    }

    await panels.drag(panels.widthHandle, 160, 0);
    await panels.drag(panels.splitHandle, 0, 80);
    await expect.poll(async () => (await panels.size(panels.query)).width).toBeGreaterThan(defaults.width + 120);
    await expect.poll(async () => (await panels.size(panels.query)).height).toBeGreaterThan(defaults.height + 60);
    expect(errors).toEqual([]);
  });

  test('keeps resizing usable when reading and writing layout storage are blocked', async ({ page }) => {
    await page.addInitScript(() => {
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key: string) {
        if (key === 'querytrace.panel-layout.v1') throw new DOMException('Storage is blocked', 'SecurityError');
        return getItem.call(this, key);
      };
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'querytrace.panel-layout.v1') throw new DOMException('Storage is full', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
    });
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    const panels = new TracerPanels(page);
    await panels.open();
    const initialQuery = await panels.size(panels.query);
    await panels.drag(panels.widthHandle, 160, 0);
    await panels.drag(panels.splitHandle, 0, 80);
    await expect.poll(async () => (await panels.size(panels.query)).width).toBeGreaterThan(initialQuery.width + 120);
    await expect.poll(async () => (await panels.size(panels.query)).height).toBeGreaterThan(initialQuery.height + 60);
    expect(errors).toEqual([]);
  });

  test('clamps panel sizes when the viewport shrinks and keeps content inside the screen', async ({ page }) => {
    const panels = new TracerPanels(page);
    await panels.open();
    await panels.drag(panels.widthHandle, 1000, 0);
    const expandedWidth = (await panels.size(panels.query)).width;
    await panels.drag(panels.splitHandle, 0, 1000);

    await page.setViewportSize({ width: 1024, height: 600 });
    await expect.poll(async () => (await panels.size(panels.query)).width).toBeLessThan(expandedWidth);
    const query = await panels.size(panels.query);
    const results = await panels.size(panels.results);
    expect(query.x).toBeGreaterThanOrEqual(0);
    expect(query.x + query.width).toBeLessThan(1024 - 300);
    expect(query.height).toBeGreaterThan(100);
    expect(results.height).toBeGreaterThan(100);
    expect(results.y + results.height).toBeLessThanOrEqual(600);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeInViewport();

    await panels.drag(panels.widthHandle, -1000, 0);
    await expect.poll(async () => (await panels.size(panels.query)).width).toBeGreaterThanOrEqual(304);
    expect((await panels.size(panels.query)).width).toBeLessThan(query.width);
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(viewport.scrollWidth).toBe(viewport.width);
    expect(viewport.scrollHeight).toBe(viewport.height);
  });
});

test('small screens keep the stacked query and results without desktop resize grips', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/trace');
  await expect(page.getByLabel('SQL query editor')).toBeVisible();
  await expect(page.getByRole('separator', { name: /Resize query and results/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'RUN', exact: true }).click();
  await expect(page.getByRole('tablist', { name: 'Execution stages' })).toBeVisible();
  await expect(page.getByLabel('SQL query editor')).toBeVisible();
  await expect(page.getByText('intermediate rows', { exact: true })).toBeVisible();
});
