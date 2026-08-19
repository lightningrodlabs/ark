import { test, expect } from '@playwright/test';

// Bug 2: the folder "+" button silently does nothing in Moss/Electron.
//
// FolderTree.svelte used `window.prompt(...)` to ask for the new folder's
// name. Electron's renderer overrides window.prompt to synchronously throw
// ("prompt() is not supported.") rather than show a dialog — see
// lib/renderer/window-setup.ts in the electron/electron repo — and that
// throw happened inside an async click handler with no try/catch, so it
// became an unhandled promise rejection: no folder, no visible error,
// nothing. (window.confirm and window.alert are NOT overridden this way —
// Electron does show native dialogs for those — so the delete-folder
// confirm() and the alert() error dialogs elsewhere are unaffected; see
// bug-open-document.spec.ts's folder-delete-relocation coverage for confirm()
// exercised end to end.)
//
// Playwright has no Electron window.prompt override to reproduce exactly,
// but its default dialog handling (auto-dismiss, i.e. prompt() resolves to
// null) reaches the same `if (name)` guard the same way a real click would
// once addFolder stopped awaiting the throwing call — either path means
// tree.addFolder(...) is never reached, which is the observable bug: the
// pane never gets a new folder.

test('creating a root folder from the "+" button adds it to the pane', async ({ page }) => {
  await page.goto('/harness/index.html');
  await expect(page.locator('.hint')).toBeVisible();

  await page.getByRole('button', { name: '+', exact: true }).click();

  // Type the name into whatever inline control the "+" click reveals, then
  // confirm with Enter — following FolderNode.svelte's rename pattern.
  const nameInput = page.locator('nav input[type="text"], nav input:not([type])');
  await expect(nameInput).toBeVisible();
  await nameInput.fill('Board Minutes');
  await nameInput.press('Enter');

  await expect(page.getByRole('button', { name: /Board Minutes/ })).toBeVisible();
});

test('Escape cancels a root folder add without creating one', async ({ page }) => {
  await page.goto('/harness/index.html');

  await page.getByRole('button', { name: '+', exact: true }).click();
  const nameInput = page.locator('nav input.add-input');
  await nameInput.fill('Should not exist');
  await nameInput.press('Escape');

  await expect(nameInput).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Should not exist/ })).toHaveCount(0);
  // The "+" button is back, ready to try again.
  await expect(page.getByRole('button', { name: '+', exact: true })).toBeVisible();
});

test('creating a sub-folder from a folder\'s "+" nests it underneath', async ({ page }) => {
  await page.goto('/harness/index.html');

  await page.getByRole('button', { name: '+', exact: true }).click();
  const rootInput = page.locator('nav input.add-input');
  await rootInput.fill('Board Minutes');
  await rootInput.press('Enter');

  const parentRow = page.locator('li', { hasText: 'Board Minutes' }).first();
  await parentRow.getByTitle('New sub-folder').click();
  const childInput = page.locator('nav input.add-input');
  await childInput.fill('2026');
  await childInput.press('Enter');

  await expect(page.getByRole('button', { name: /^2026/ })).toBeVisible();
});
