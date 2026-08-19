import { test, expect } from '@playwright/test';
import { createDocument } from './helpers';

// An empty query used to fall back to a browse: every document passing the
// filters, sorted by date. Clearing the search box (with or without a filter
// still set, e.g. "include trashed") therefore presented the whole archive as
// if it were search output. Task B's fix: an empty query always yields zero
// hits. See ui/src/search/index.ts and ui/src/search/index.test.ts.

test('clearing the search box after a hit drops the result count to zero', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createDocument(page, {
    title: 'Fundraiser recap',
    body: 'The bake sale raised eight hundred dollars for the roof fund.',
  });

  const search = page.locator('input[type="search"]');
  const resultCount = page.locator('.bar .count');
  const hit = page.locator('.list-column').getByRole('button', { name: /Fundraiser recap/ });

  await search.fill('bake sale');
  await expect(resultCount).toHaveText('1 result');
  await expect(hit).toBeVisible();

  // Clearing the box with no filter set falls back to the ordinary
  // folder-scoped document list (unchanged — see App.svelte's `searching`
  // derivation), where the one document in the archive still legitimately
  // appears. The search *result count* dropping to zero, rather than staying
  // at 1, is what proves the empty query itself no longer matches anything —
  // the other spec in this file covers the case where a filter keeps the
  // search pane (not the file list) active with the box empty.
  await search.fill('');
  await expect(resultCount).toHaveText('0 results');
});

test('an empty query with a filter set still returns zero results', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createDocument(page, {
    title: 'Fundraiser recap',
    body: 'The bake sale raised eight hundred dollars for the roof fund.',
  });

  const resultCount = page.locator('.bar .count');

  // Trigger the search pane with the box empty by turning on a filter alone
  // — the exact bug report: "include trashed" with no query text showed the
  // entire archive.
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('checkbox', { name: 'Include trashed' }).check();

  await expect(resultCount).toHaveText('0 results');
  await expect(
    page.locator('.list-column').getByRole('button', { name: /Fundraiser recap/ }),
  ).toHaveCount(0);
});
