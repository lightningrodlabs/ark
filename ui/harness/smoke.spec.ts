import { test, expect } from '@playwright/test';

test('app boots against the stub client and shows the empty archive', async ({ page }) => {
  await page.goto('/harness/index.html');
  // The <h1>ark</h1> is deliberately gone: Moss's tool bar already names the
  // applet, so a second title only cost vertical space.
  await expect(page.locator('h1')).toHaveCount(0);

  // The tree is present but has nothing in it — a fresh archive has no
  // folders, and there is no node standing for "all documents", so sl-tree
  // itself has no height to be "visible" by.
  await expect(page.locator('sl-tree')).toBeAttached();
  await expect(page.locator('sl-tree-item')).toHaveCount(0);
  await expect(page.locator('.head strong')).toHaveText('Folders');

  await expect(page.locator('text=Loading documents')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.hint')).toHaveText('Select a document from the tree, or create one.');
});
