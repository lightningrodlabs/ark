import { test, expect, type Page } from '@playwright/test';
import { COMMITTEES, TOTAL_DOCUMENTS } from './seed';

// The boot used to page the whole corpus in and then build the search index in
// one `rebuild()` — 546ms of synchronous main thread at 1406 documents, spent
// at the moment the app looks finished and the user reaches for the search box.
// Each page is now indexed as it lands, so the index is complete when the last
// page is, and there is no separate pass at the end.
//
// What must NOT change is the user-visible contract: search still refuses to
// answer from a partially loaded archive, and says how far along it is. That
// half is pinned in progressive-load.spec.ts; the first test here re-checks it
// specifically against an index that is now genuinely half-built, which is the
// case where a regression would answer confidently and wrongly.

const SEEDED_STALLED = '/harness/index.html?seed=archive&stall=get_all_documents';

const loadingNote = (page: Page) => page.locator('[data-testid="loading-note"]');
const releaseOnePage = (page: Page) => page.evaluate(() => (window as any).__ARK_RELEASE_ONE__());
const releaseAll = (page: Page) => page.evaluate(() => (window as any).__ARK_RELEASE__());
const indexCalls = (page: Page): Promise<{ rebuilds: number; indexed: number }> =>
  page.evaluate(() => (window as any).__ARK_INDEX_CALLS__);

test('the corpus is indexed page by page, with no rebuild pass at the end', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(SEEDED_STALLED);
  await expect(page.locator('sl-tree-item[data-kind="folder"]')).toHaveCount(COMMITTEES, {
    timeout: 15_000,
  });

  // Nothing indexed before the first page arrives.
  expect(await indexCalls(page)).toEqual({ rebuilds: 0, indexed: 0 });

  await releaseOnePage(page);
  await expect(loadingNote(page)).toContainText(`100 of ${TOTAL_DOCUMENTS}`);
  expect((await indexCalls(page)).indexed).toBe(100);

  await releaseOnePage(page);
  await expect(loadingNote(page)).toContainText(`200 of ${TOTAL_DOCUMENTS}`);
  expect((await indexCalls(page)).indexed).toBe(200);

  // Half the archive is in the index, and search still refuses — the index
  // being ready-as-it-goes must not become search answering as it goes.
  await page.locator('input[type="search"]').fill('treasurer');
  await expect(page.locator('[data-testid="search-loading"]')).toBeVisible();
  await expect(page.locator('.search-popup li.result')).toHaveCount(0);

  await releaseAll(page);
  await expect(loadingNote(page)).toHaveCount(0, { timeout: 30_000 });

  // The same query answers the moment the load finishes...
  await expect(page.locator('.search-popup li.result').first()).toBeVisible({ timeout: 30_000 });

  // ...and every document was indexed on the way in, with no rebuild pass.
  const calls = await indexCalls(page);
  expect(calls.indexed).toBe(TOTAL_DOCUMENTS);
  expect(calls.rebuilds).toBe(0);
});

test('a cold boot reaches a working search over the whole archive', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/harness/index.html?seed=archive');
  await expect(loadingNote(page)).toHaveCount(0, { timeout: 30_000 });

  // Every seeded body begins "Minutes of…" (see seed.ts), so a search that
  // covers the whole archive is a search that finds all of it — an index built
  // over only the pages that happened to arrive would return a plausible
  // fraction instead.
  await page.locator('input[type="search"]').fill('minutes');
  await expect(page.locator('[data-testid="search-loading"]')).toHaveCount(0);
  await expect(page.locator('.search-popup li.result').first()).toBeVisible();
  await expect(page.locator('.search .bar .count')).toHaveText(`${TOTAL_DOCUMENTS} results`);
  expect(await indexCalls(page)).toEqual({ rebuilds: 0, indexed: TOTAL_DOCUMENTS });
});
