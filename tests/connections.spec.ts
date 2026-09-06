import { expect, test, type Page } from '@playwright/test';

async function verifyConnections(page: Page) {
  const wires = await page.locator('.key-connection').evaluateAll((connections) => connections.map((connection) => {
    const path = connection.querySelector('.react-flow__edge-path') as SVGPathElement;
    const points = [...path.getAttribute('d')!.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({ x: +match[1], y: +match[2] }));
    const matrix = path.getScreenCTM()!;
    const title = connection.querySelector('title')!.textContent!;
    const ends = title.split(' → ').map((label, i) => {
      const [table, column] = label.split('.');
      const node = document.querySelector(`[data-testid="rf__node-${table}"]`)!;
      const cell = node.querySelector(`[data-column="${column}"]`)!.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      const point = points[i ? points.length - 1 : 0];
      const endpoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      const side = connection.getAttribute(i ? 'data-target-side' : 'data-source-side');
      return { x: endpoint.x, y: endpoint.y, expectedX: (cell.left + cell.right) / 2, expectedY: side === 'top' ? rect.top : rect.bottom };
    });
    return { points, ends, path: path.getAttribute('d') };
  }));
  for (const wire of wires) {
    expect(wire.path).not.toMatch(/[CQAST]/);
    for (let i = 1; i < wire.points.length; i++) {
      const before = wire.points[i - 1];
      const after = wire.points[i];
      expect(before.x === after.x || before.y === after.y).toBe(true);
    }
    for (const end of wire.ends) {
      expect(Math.abs(end.x - end.expectedX)).toBeLessThan(2);
      expect(Math.abs(end.y - end.expectedY)).toBeLessThan(2);
    }
  }
}

test('key wires use square bends and stay aligned with column borders when tables move', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('.key-connection')).toHaveCount(3);
  await expect(page.locator('.key-connection[data-target-side="bottom"]').first()).toBeAttached();
  await verifyConnections(page);
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    const node = page.getByTestId('rf__node-OBSERVATION');
    const before = await page.locator('.key-connection .react-flow__edge-path').evaluateAll((paths) => paths.map((path) => path.getAttribute('d')));
    const header = await node.getByText('OBSERVATION', { exact: true }).boundingBox();
    await page.mouse.move(header!.x + 20, header!.y + header!.height / 2);
    await page.mouse.down();
    await page.mouse.move(header!.x + 70, header!.y + 100, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => page.locator('.key-connection .react-flow__edge-path').evaluateAll((paths) => paths.map((path) => path.getAttribute('d')))).not.toEqual(before);
    await verifyConnections(page);
  }
  await page.screenshot({ path: testInfo.outputPath('connections.png') });
});
