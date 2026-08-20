import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BIGGEST_COMMITTEE, COMMITTEES, TOTAL_DOCUMENTS } from './seed';

// Two reports of the same complaint: a long operation shows nothing while it
// runs.
//
// The initial load used to render `<p>Loading documents… N</p>` INSTEAD OF the
// app until every page of `get_all_documents` had come back — fifteen round
// trips of one line of text on the reference archive. The tree does not depend
// on documents having arrived, and the document store is reactive, so there was
// never a reason to withhold the whole application.
//
// `?stall=get_all_documents` (see harness-main.ts) parks the paging before the
// app mounts; `__ARK_RELEASE_ONE__` lets exactly one page through and parks the
// next, so the load can be walked a page at a time and asserted on in between.

const SEEDED_STALLED = '/harness/index.html?seed=archive&stall=get_all_documents';

const loadingNote = (page: Page) => page.locator('[data-testid="loading-note"]');
const releaseOnePage = (page: Page) =>
  page.evaluate(() => (window as any).__ARK_RELEASE_ONE__());
const releaseAll = (page: Page) => page.evaluate(() => (window as any).__ARK_RELEASE__());

/** The tree's own count badge for a committee. */
const folderCount = (page: Page, name: string) =>
  page.locator(`sl-tree-item[data-kind="folder"][data-name="${name}"] .count`);

test('the app renders while the corpus is still arriving, never a full-screen loading state', async ({
  page,
}) => {
  await page.goto(SEEDED_STALLED);

  // The folder tree comes from its own zome call and has already arrived.
  await expect(page.locator('sl-tree-item[data-kind="folder"]')).toHaveCount(COMMITTEES, {
    timeout: 15_000,
  });
  // Everything the app is made of is on screen: toolbar, search, both panes.
  await expect(page.getByRole('button', { name: 'New document' })).toBeVisible();
  await expect(page.locator('input[type="search"]')).toBeVisible();
  await expect(page.locator('.pane-end .hint')).toBeVisible();
  // And the old full-screen replacement — one line of text INSTEAD of the app
  // — is gone: the split panel is what fills the window.
  await expect(page.locator('sl-split-panel.layout')).toBeVisible();
  await expect(page.getByText('Loading documents…')).toHaveCount(0);

  // Progress is shown, but as a banner alongside the app rather than instead
  // of it.
  await expect(loadingNote(page)).toBeVisible();

  await releaseAll(page);
  await expect(loadingNote(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(folderCount(page, 'Committee 1')).toHaveText(String(BIGGEST_COMMITTEE));
});

test('the document count climbs as pages arrive', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(SEEDED_STALLED);
  await expect(page.locator('sl-tree-item[data-kind="folder"]')).toHaveCount(COMMITTEES, {
    timeout: 15_000,
  });

  // Committee 1 holds the first 280 documents in creation order, so the first
  // three 100-document pages land in it and its count is the one that moves.
  // The archive's size is not known until the first page comes back — it is
  // reported alongside it — so the banner counts from "0 of ?" rather than
  // paying an extra round trip to say a number one page earlier.
  await expect(folderCount(page, 'Committee 1')).toHaveText('0');
  await expect(loadingNote(page)).toContainText('0 of ?');

  await releaseOnePage(page);
  await expect(folderCount(page, 'Committee 1')).toHaveText('100');
  await expect(loadingNote(page)).toContainText(`100 of ${TOTAL_DOCUMENTS}`);

  await releaseOnePage(page);
  await expect(folderCount(page, 'Committee 1')).toHaveText('200');
  await expect(loadingNote(page)).toContainText(`200 of ${TOTAL_DOCUMENTS}`);

  // Documents that have arrived are readable, not merely counted.
  await page.locator('sl-tree-item[data-kind="folder"][data-name="Committee 1"] .name').click();
  await expect(page.locator('sl-tree-item[data-kind="doc"]').first()).toBeVisible();

  await releaseAll(page);
  await expect(loadingNote(page)).toHaveCount(0, { timeout: 30_000 });
});

// Search is the one thing that legitimately needs the whole corpus: an index
// over a third of it silently answers for a third of the archive, and that
// exact failure has bitten this project before. It refuses, and says how far
// along the load is, rather than answering from a partial index.
test('search refuses to answer from a partial corpus, and says how far along it is', async ({
  page,
}) => {
  await page.goto(SEEDED_STALLED);
  await expect(page.locator('sl-tree-item[data-kind="folder"]')).toHaveCount(COMMITTEES, {
    timeout: 15_000,
  });
  await releaseOnePage(page);
  await expect(loadingNote(page)).toContainText(`100 of ${TOTAL_DOCUMENTS}`);

  await page.locator('input[type="search"]').fill('treasurer');

  // No hits, no result rows — and an explicit reason, not silence.
  await expect(page.locator('[data-testid="search-loading"]')).toBeVisible();
  await expect(page.locator('[data-testid="search-loading"]')).toContainText(
    `100 of ${TOTAL_DOCUMENTS}`,
  );
  await expect(page.locator('.search-popup li.result')).toHaveCount(0);

  await releaseAll(page);
  // Once the whole archive is in, the same query answers over all of it.
  await expect(page.locator('[data-testid="search-loading"]')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.search-popup li.result').first()).toBeVisible({ timeout: 30_000 });
});

// The Unfiled bin offers "Move all here". A document whose filing link has not
// been read yet looks exactly like one that was never filed, so offering to
// re-file it mid-load is the same real damage the pending-structure banner
// exists to prevent.
test('the Unfiled bin is not offered while the corpus is still loading', async ({ page }) => {
  await page.goto(SEEDED_STALLED);
  await expect(page.locator('sl-tree-item[data-kind="folder"]')).toHaveCount(COMMITTEES, {
    timeout: 15_000,
  });
  await releaseOnePage(page);
  await expect(loadingNote(page)).toContainText(`100 of ${TOTAL_DOCUMENTS}`);

  await expect(page.getByRole('button', { name: 'Move all here' })).toHaveCount(0);

  await releaseAll(page);
  await expect(loadingNote(page)).toHaveCount(0, { timeout: 30_000 });
});

// A cold start with nothing in the archive must land on the empty app, not sit
// on a loading state forever.
test('an empty archive lands on the app, not a permanent loading state', async ({ page }) => {
  await page.goto('/harness/index.html');
  await expect(page.getByRole('button', { name: 'New document' })).toBeVisible();
  await expect(page.locator('.pane-end .hint')).toBeVisible();
  await expect(loadingNote(page)).toHaveCount(0);
  await expect(page.locator('input[type="search"]')).toBeEnabled();
});

// ---------------------------------------------------------------------------
// Bug 2: the import progress label.
// ---------------------------------------------------------------------------

/** More than one slice's worth of minutes, so progress has somewhere to go. */
const IMPORT_DOCS = 8;
let importDir: string;
test.beforeAll(() => {
  importDir = mkdtempSync(join(tmpdir(), 'ark-progress-'));
  for (let i = 0; i < IMPORT_DOCS; i++) {
    writeFileSync(
      join(importDir, `doc-${i}.md`),
      `---\ntitle: Minutes ${i}\ndate: 2014-03-${String(i + 1).padStart(2, '0')}\nfolder: Finance\n---\n\nThe treasurer reported item ${i}.\n`,
    );
  }
});
test.afterAll(() => rmSync(importDir, { recursive: true, force: true }));

async function openImport(page: Page): Promise<void> {
  await page.locator('sl-icon-button.about').click();
  await page.getByRole('button', { name: 'Import…' }).click();
}

const importButton = (page: Page) =>
  page.locator('.pane-end button', { hasText: /^(Import|Importing)/ });

test('the import progress label advances while the run is in flight', async ({ page }) => {
  await page.goto('/harness/index.html');
  await expect(page.getByRole('button', { name: 'New document' })).toBeVisible();
  await openImport(page);
  await page.setInputFiles('.pane-end input[type="file"]', importDir);
  await expect(page.locator('.pane-end .summary')).toContainText(String(IMPORT_DOCS));

  // Hold every create_document, so the run is genuinely in flight rather than
  // racing an in-memory stub that answers faster than Playwright can look.
  await page.evaluate(() => (window as any).__ARK_STALL__('create_document'));
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  await expect(importButton(page)).toHaveText(`Importing 0/${IMPORT_DOCS}…`);

  // One document at a time, the label has to keep up. The last one is left
  // parked: releasing it ends the run, and the button goes back to being a
  // summary rather than a progress label.
  for (let done = 1; done < IMPORT_DOCS; done++) {
    await releaseOnePage(page);
    await expect(importButton(page)).toHaveText(`Importing ${done}/${IMPORT_DOCS}…`);
  }

  await releaseAll(page);
  await expect(page.locator('.pane-end .result')).toContainText(
    `${IMPORT_DOCS} document(s) created`,
  );
});
