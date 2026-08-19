import { test, expect } from '@playwright/test';
import { createDocument, createRootFolder, selectFolder } from './helpers';

// The reported bug: a user imported the full corpus, searched for a common first name,
// and saw nothing — despite 943 of 1406 documents containing it. The index
// itself was fine (see ui/src/search/index.test.ts). The cause was
// App.svelte passing the tree's *selected* folder straight through to
// search.run() as a filter, so search silently inherited whatever folder was
// selected in the tree. Anyone who had clicked into a folder — the normal
// thing to do after an import — got every search invisibly scoped to it.
//
// Fix: search is global by default; folder scope is an explicit, visible
// opt-in (a chip offered in the search bar, only when a folder is selected,
// that must be turned on and can be dismissed) — never inherited from tree
// selection.

async function seed(page: any) {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Finance');
  await selectFolder(page, 'Finance');
  await createDocument(page, {
    title: 'Finance minutes',
    body: 'The treasurer introduced Robin as the new signatory.',
    date: '2026-01-05',
  });

  await createRootFolder(page, 'Legal');
  await selectFolder(page, 'Legal');
}

test('selecting a folder in the tree does not scope search results', async ({ page }) => {
  await seed(page);
  // "Legal" is selected in the tree (no documents filed there). The term only
  // appears in a document filed under "Finance".
  const search = page.locator('input[type="search"]');
  await search.fill('robin');

  await expect(page.locator('.bar .count')).toHaveText('1 result');
  await expect(page.locator('.search-popup .panel li.result', { hasText: 'Finance minutes' })).toBeVisible();
});

test('a folder scope chip is offered, narrows results when turned on, and widens again when dismissed', async ({
  page,
}) => {
  await seed(page);
  const search = page.locator('input[type="search"]');
  await search.fill('robin');
  await expect(page.locator('.bar .count')).toHaveText('1 result');

  // Opt-in: offered because "Legal" is selected in the tree, but not active
  // until the user turns it on.
  const offer = page.getByRole('button', { name: /Scope to Legal/i });
  await expect(offer).toBeVisible();
  await offer.click();

  // Visible, dismissible chip; narrows the results to the (empty) selected
  // folder.
  const chip = page.locator('.scope-chip', { hasText: 'Legal' });
  await expect(chip).toBeVisible();
  await expect(page.locator('.bar .count')).toHaveText('0 results');

  // The scoped-zero-results fallback: offers the way out rather than just
  // going quiet.
  await expect(page.locator('.scope-empty')).toContainText('1');
  await page.getByRole('button', { name: 'Search everywhere' }).click();
  await expect(page.locator('.bar .count')).toHaveText('1 result');
  await expect(page.locator('.scope-chip')).toHaveCount(0);
});
