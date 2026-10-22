import { expect, test } from '@playwright/test';

test('dialogs contain keyboard focus, make background controls inert, and restore their opener', async ({ page }) => {
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'Open schema settings' })).toBeEnabled();

  for (const [name, openerName, closeName] of [
    ['Schema', 'Open schema settings', 'Close schema settings'],
    ['Lessons', 'Open lessons', 'Close lessons'],
    ['Help', 'Open help', 'Close help'],
  ]) {
    const opener = page.getByRole('button', { name: openerName, exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: closeName, exact: true })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(1);

    // Native modality prevents scripts and keyboard users from activating the
    // underlying toolbar, even while it remains visibly behind the backdrop.
    expect(await page.evaluate(() => {
      const background = document.querySelector<HTMLElement>('button[aria-label="Open help"]')!;
      background.focus();
      return document.querySelector('dialog[open]')!.contains(document.activeElement);
    })).toBe(true);

    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: closeName, exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  }
});

test('switching from Help to another dialog retains focus and restores the toolbar afterwards', async ({ page }) => {
  await page.goto('/trace');
  await expect(page.getByRole('button', { name: 'Open schema settings' })).toBeEnabled();
  const opener = page.getByRole('button', { name: 'Open help', exact: true });
  for (const [action, target] of [['OPEN LESSONS', 'Lessons'], ['LOAD A SCHEMA', 'Schema']]) {
    await opener.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Help', exact: true }).locator('#help-overview').getByRole('button', { name: action, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: target, exact: true });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  }
});
