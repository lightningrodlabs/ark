import { test, expect } from '@playwright/test';

test('app boots against the stub client and shows the empty archive', async ({ page }) => {
  await page.goto('/harness/index.html');
  await expect(page.locator('h1')).toHaveText('ark');
  await expect(page.locator('text=Loading documents')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.hint')).toHaveText('Select a document.');
});
