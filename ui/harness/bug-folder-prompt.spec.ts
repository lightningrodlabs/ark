import { test, expect } from '@playwright/test';
import { createRootFolder, createSubFolder, folderNode } from './helpers';

// Bug 2: the folder "+" button silently does nothing in Moss/Electron.
//
// The folder pane (then FolderTree.svelte, now ArkTree.svelte) used
// `window.prompt(...)` to ask for the new folder's
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

test('creating a root folder from the "New folder" button adds it to the tree', async ({ page }) => {
  await page.goto('/harness/index.html');
  await expect(page.locator('.hint')).toBeVisible();

  await page.getByRole('button', { name: 'New folder' }).click();

  // Type the name into the inline control the button reveals, then confirm
  // with Enter — the same inline pattern folder renaming uses.
  const nameInput = page.locator('nav input.add-input');
  await expect(nameInput).toBeVisible();
  await nameInput.fill('Board Minutes');
  await nameInput.press('Enter');

  await expect(folderNode(page, 'Board Minutes')).toBeVisible();
});

test('Escape cancels a root folder add without creating one', async ({ page }) => {
  await page.goto('/harness/index.html');

  await page.getByRole('button', { name: 'New folder' }).click();
  const nameInput = page.locator('nav input.add-input');
  await nameInput.fill('Should not exist');
  await nameInput.press('Escape');

  await expect(nameInput).toHaveCount(0);
  await expect(folderNode(page, 'Should not exist')).toHaveCount(0);
  // The button is back, ready to try again.
  await expect(page.getByRole('button', { name: 'New folder' })).toBeVisible();
});

test('creating a sub-folder from a folder\'s action menu nests it underneath', async ({ page }) => {
  await page.goto('/harness/index.html');

  await createRootFolder(page, 'Board Minutes');
  await createSubFolder(page, 'Board Minutes', '2026');

  // Nested inside the parent node, not merely present somewhere in the tree.
  await expect(
    folderNode(page, 'Board Minutes').locator('sl-tree-item[data-name="2026"]'),
  ).toHaveCount(1);
});
