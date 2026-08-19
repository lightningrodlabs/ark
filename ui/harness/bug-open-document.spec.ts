import { test, expect } from '@playwright/test';

// Bug 3: "I can't seem to click on the created test document to read it."
// Not diagnosed ahead of time — this spec drives the reported path with
// several plausible variations and asserts the body becomes visible, so a
// failure shows exactly what breaks.

test('a document created and read back immediately opens fine', async ({ page }) => {
  await page.goto('/harness/index.html');

  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByPlaceholder('Title').fill('Annual Meeting');
  await page.locator('textarea').fill('We approved the budget.');
  await page.getByRole('button', { name: 'Add document' }).click();
  await expect(page.getByRole('heading', { name: 'Annual Meeting' })).toBeVisible();
});

test('the same document can be re-opened from the main list after navigating away', async ({
  page,
}) => {
  await page.goto('/harness/index.html');

  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByPlaceholder('Title').fill('Annual Meeting');
  await page.locator('textarea').fill('We approved the budget.');
  await page.getByRole('button', { name: 'Add document' }).click();
  await page.getByRole('button', { name: 'All documents' }).click();

  const listEntry = page.locator('.list-column').getByRole('button', { name: /Annual Meeting/ });
  await expect(listEntry).toBeVisible();
  await listEntry.click();

  await expect(page.getByRole('heading', { name: 'Annual Meeting' })).toBeVisible();
  await expect(page.locator('.body')).toContainText('We approved the budget.');
});

// The specific case that turned out to reproduce: a document created with no
// folder selected ("All documents" active) is filed nowhere, so it lands in
// the "Unfiled" bin in the sidebar as well as the main document list.
// OrphanBin.svelte rendered those entries as bare <li> text with no button
// and no onclick — clicking one did nothing. A new user who creates a test
// document without first picking a folder sees it appear in the sidebar's
// "Unfiled" list right next to the folder tree — indistinguishable at a
// glance from "the list" the app otherwise trains you to click into — and
// clicking it there was a dead end even though the separately rendered main
// list was clickable. Fixed by giving OrphanBin entries an onOpen button,
// same as DocumentList and SearchResults.
test('an unfiled document listed in the sidebar Unfiled bin can be opened by clicking it', async ({
  page,
}) => {
  await page.goto('/harness/index.html');

  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByPlaceholder('Title').fill('Unfiled Test Doc');
  await page.locator('textarea').fill('Body text to confirm on open.');
  await page.getByRole('button', { name: 'Add document' }).click();
  await page.getByRole('button', { name: 'All documents' }).click();

  const orphanEntry = page.locator('section', { hasText: 'Unfiled' }).getByText('Unfiled Test Doc');
  await expect(orphanEntry).toBeVisible();
  await orphanEntry.click();

  await expect(page.getByRole('heading', { name: 'Unfiled Test Doc' })).toBeVisible();
  await expect(page.locator('.body')).toContainText('Body text to confirm on open.');
});
