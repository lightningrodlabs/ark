import { test, expect } from '@playwright/test';
import {
  createDocument,
  createRootFolder,
  documentNode,
  folderMenuAction,
  folderNode,
  openDocument,
  selectFolder,
} from './helpers';

// These specs walk the paths a person actually uses. Together with the two
// bug-repro specs they are the closest thing this repo has to documentation
// of how the UI behaves, so keep them readable rather than clever.

test('creating a folder shows it in the pane', async ({ page }) => {
  await page.goto('/harness/index.html');

  await createRootFolder(page, 'Board Minutes');

  await expect(folderNode(page, 'Board Minutes')).toBeVisible();
});

test('a document created into a folder appears in that folder\'s list and can be read', async ({
  page,
}) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');

  await createDocument(page, {
    title: 'January meeting',
    body: 'We approved the annual budget of $12,000.',
    date: '2026-01-15',
  });

  // Creating opens the document directly; back out to the folder and click
  // the leaf to confirm it is really filed there, not just held in memory.
  await selectFolder(page, 'Board Minutes');
  await expect(documentNode(page, 'January meeting')).toBeVisible();
  await openDocument(page, 'January meeting');

  await expect(page.getByRole('heading', { name: 'January meeting' })).toBeVisible();
  await expect(page.locator('.body')).toContainText('We approved the annual budget of $12,000.');
});

test('amending a document keeps the old body reachable and adds a version', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createDocument(page, { title: 'Minutes', body: 'Original wording of the minutes.' });

  // No version history yet — a single-version document has nothing to show.
  await expect(page.locator('.history')).toHaveCount(0);

  await page.getByRole('button', { name: 'Amend' }).click();
  await page.locator('textarea').fill('Corrected wording of the minutes.');
  await page.getByRole('button', { name: 'Save amendment' }).click();

  await expect(page.locator('.body')).toContainText('Corrected wording of the minutes.');
  await expect(page.locator('.history li')).toHaveCount(2);
  await expect(page.locator('.history')).toContainText('current');
});

test('search finds a document by a word in its body, and reports no hits for an absent word', async ({
  page,
}) => {
  await page.goto('/harness/index.html');
  await createDocument(page, {
    title: 'Fundraiser recap',
    body: 'The bake sale raised eight hundred dollars for the roof fund.',
  });

  const search = page.locator('input[type="search"]');
  const resultCount = page.locator('.bar .count');
  // Results are an overlay anchored to the input now, not a column that
  // replaced the tree — see search-overlay.spec.ts.
  const hit = page.locator('.search-popup .panel li.result', { hasText: 'Fundraiser recap' });
  await search.fill('bake sale');
  await expect(resultCount).toHaveText('1 result');
  await expect(hit).toBeVisible();

  await search.fill('zoning variance');
  await expect(resultCount).toHaveText('0 results');
  await expect(hit).toHaveCount(0);
});

test('trashing a document removes it from the list and Trash; restoring returns it', async ({
  page,
}) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  await createDocument(page, { title: 'Draft agenda', body: 'Item one, item two.' });

  await page.getByRole('button', { name: 'Trash' }).click();

  // Gone from the folder it was filed in...
  await selectFolder(page, 'Board Minutes');
  await expect(documentNode(page, 'Draft agenda')).toHaveCount(0);

  // ...and listed in the Trash section below the tree.
  const trashSection = page.locator('section', { hasText: 'Trash' });
  const trashEntry = trashSection.getByRole('button', { name: 'Draft agenda' });
  await expect(trashEntry).toBeVisible();

  await trashSection.getByRole('button', { name: 'Restore' }).click();

  await expect(trashSection.getByRole('button', { name: 'Draft agenda' })).toHaveCount(0);
  await selectFolder(page, 'Board Minutes');
  await expect(documentNode(page, 'Draft agenda')).toBeVisible();
});

test('deleting a folder relocates the document inside it rather than losing it', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Old Committee');
  await selectFolder(page, 'Old Committee');
  await createDocument(page, { title: 'Committee notes', body: 'Notes from the old committee.' });

  await selectFolder(page, 'Old Committee');
  await expect(documentNode(page, 'Committee notes')).toBeVisible();

  // Deleting a root folder relocates its documents to Unfiled (no parent to
  // fall back to) — see planFolderDeletion in tree/deletion.ts. confirm() IS
  // implemented by Electron (unlike prompt() — see bug-folder-prompt.spec.ts),
  // so accepting it here is the same path a real click takes.
  page.once('dialog', (dialog) => dialog.accept());
  await folderMenuAction(page, 'Old Committee', 'Delete');

  await expect(folderNode(page, 'Old Committee')).toHaveCount(0);

  // Relocated to Unfiled, which is where a document belonging to no folder is
  // reachable now that the tree shows real folders only.
  const unfiledSection = page.locator('section', { hasText: 'Unfiled' });
  const unfiledEntry = unfiledSection.getByRole('button', { name: /Committee notes/ });
  await expect(unfiledEntry).toBeVisible();
  await unfiledEntry.click();
  await expect(page.getByRole('heading', { name: 'Committee notes' })).toBeVisible();
});
