import { test, expect } from '@playwright/test';
import { createDocument, createRootFolder, selectFolder } from './helpers';

// An empty query used to fall back to a browse: every document passing the
// filters, sorted by date. Clearing the search box (with or without a filter
// still set, e.g. "include trashed") therefore presented the whole archive as
// if it were search output. Task B's fix: an empty query always yields zero
// hits. See ui/src/search/index.ts and ui/src/search/index.test.ts.
//
// With results now an anchored overlay, "zero hits" also means the overlay
// simply never opens — there is nothing to float over the tree.

test('clearing the search box after a hit drops the result count to zero', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  await createDocument(page, {
    title: 'Fundraiser recap',
    body: 'The bake sale raised eight hundred dollars for the roof fund.',
  });

  const search = page.locator('input[type="search"]');
  const resultCount = page.locator('.bar .count');
  const hit = page.locator('.search-popup .panel li.result', { hasText: 'Fundraiser recap' });

  await search.fill('bake sale');
  await expect(resultCount).toHaveText('1 result');
  await expect(hit).toBeVisible();

  // Clearing the box takes the overlay away entirely — an empty query matches
  // nothing, so there are no results to float over the tree. The count
  // dropping to zero, rather than staying at 1, is what proves the empty
  // query itself no longer matches; the tree underneath is untouched, which
  // is the point of making the results an overlay in the first place.
  await search.fill('');
  await expect(resultCount).toHaveText('0 results');
  await expect(hit).toHaveCount(0);
  await expect(page.locator('sl-tree')).toBeVisible();
});

test('an empty query with a filter set still returns zero results', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createDocument(page, {
    title: 'Fundraiser recap',
    body: 'The bake sale raised eight hundred dollars for the roof fund.',
  });

  const resultCount = page.locator('.bar .count');

  // Trigger a search with the box empty by turning on a filter alone — the
  // exact bug report: "include trashed" with no query text showed the entire
  // archive.
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('checkbox', { name: 'Include trashed' }).check();

  await expect(resultCount).toHaveText('0 results');
  // No hits means no overlay: it is not active when there is nothing to show.
  await expect(page.locator('.search-popup .panel')).toHaveCount(0);
});
