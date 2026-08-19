import { test, expect } from '@playwright/test';
import { createRootFolder, createSubFolder, selectFolder } from './helpers';

// Bug: creating a document while "All documents" is selected filed it
// nowhere, leaving the author to find it in the Unfiled bin and re-file it
// by hand. DocumentEditor now carries a folder picker in create mode
// (defaulting to the currently selected folder, required unless the archive
// has no folders at all) so a document is filed correctly at creation time.

test('creating with a folder selected pre-fills that folder and files the document there', async ({
  page,
}) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');

  await page.getByRole('button', { name: 'New document' }).click();
  const folderPicker = page.locator('select.folder-picker');
  await expect(folderPicker).toHaveValue(/.+/); // pre-filled, not the empty placeholder
  await expect(folderPicker.locator('option:checked')).toHaveText('Board Minutes');

  await page.getByPlaceholder('Title').fill('January meeting');
  await page.locator('textarea').fill('Approved the budget.');
  await page.getByRole('button', { name: 'Add document' }).click();

  await selectFolder(page, 'Board Minutes');
  await expect(
    page.locator('.list-column').getByRole('button', { name: /January meeting/ }),
  ).toBeVisible();
  await expect(page.locator('section', { hasText: 'Unfiled' })).toHaveCount(0);
});

test('creating from "All documents" cannot be saved until a folder is chosen', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await createSubFolder(page, 'Board Minutes', '2026');
  // Stay on "All documents" (selectedFolder === null) — the reported case.

  await page.getByRole('button', { name: 'New document' }).click();
  const folderPicker = page.locator('select.folder-picker');
  await expect(folderPicker).toHaveValue('');

  const addButton = page.getByRole('button', { name: 'Add document' });
  await page.getByPlaceholder('Title').fill('Unfiled by mistake');
  await page.locator('textarea').fill('Body text.');
  await expect(addButton).toBeDisabled();
  await expect(page.locator('.editor')).toContainText('Choose a folder');

  await folderPicker.selectOption({ label: 'Board Minutes' });
  await expect(addButton).toBeEnabled();

  await addButton.click();
  await selectFolder(page, 'Board Minutes');
  await expect(
    page.locator('.list-column').getByRole('button', { name: /Unfiled by mistake/ }),
  ).toBeVisible();
});

test('with no folders in the archive, creating still works and produces an unfiled document', async ({
  page,
}) => {
  await page.goto('/harness/index.html');
  // A fresh archive has no folders — must not trap the user into leaving the
  // editor to create one first.

  await page.getByRole('button', { name: 'New document' }).click();
  await expect(page.locator('select.folder-picker')).toHaveCount(0);
  await expect(page.locator('.editor')).toContainText('No folders yet');

  const addButton = page.getByRole('button', { name: 'Add document' });
  await page.getByPlaceholder('Title').fill('First ever document');
  await page.locator('textarea').fill('Body text.');
  await expect(addButton).toBeEnabled();
  await addButton.click();

  await expect(page.getByRole('heading', { name: 'First ever document' })).toBeVisible();
  const unfiledSection = page.locator('section', { hasText: 'Unfiled' });
  await expect(unfiledSection.getByText('First ever document')).toBeVisible();
});
