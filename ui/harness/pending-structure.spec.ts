import { test, expect } from '@playwright/test';
import { PENDING_STRUCTURE_FOLDER, PENDING_STRUCTURE_DOCS } from './seed';

// The load-phase gap: a node can gossip in a document's filing link before
// the folder-tree entry that names its folder (root LINKS and the FolderTree
// ENTRY they point at gossip independently — see folder.rs's get_folder_tree
// and TreeStore.structurePending). Read literally, `get_folder_tree` then
// looks identical to "this archive has no folders", which puts every filed
// document in the Unfiled bin next to a "Move all here" bulk control — real
// damage waiting to happen to an archive that was never actually unfiled.
//
// `?seed=pending-structure` seeds one folder with two documents filed in it,
// then marks the tree's root link as arrived without its entry (see
// stub-client.ts's simulateStructurePending). `__ARK_RESOLVE_TREE__`
// simulates the entry gossiping in later, the way a reconcile would.

const PENDING = '/harness/index.html?seed=pending-structure';
const banner = '.structure-pending-note';

test('the banner appears, the Unfiled bin does not, and documents stay readable and searchable', async ({
  page,
}) => {
  await page.goto(PENDING);

  await expect(page.locator(banner)).toBeVisible();
  await expect(page.locator(banner)).toContainText('folder structure');
  await expect(page.locator(banner)).toContainText('2');

  // The folder itself is unknown yet — root_count > heads.length means the
  // tree's content has not arrived either, not merely the filing.
  await expect(page.locator('sl-tree-item[data-kind="folder"]')).toHaveCount(0);

  // The dangerous control: with two documents filed but zero folders known,
  // the old behaviour put both in Unfiled next to "Move all here".
  await expect(page.locator('section', { hasText: 'Unfiled' })).toHaveCount(0);

  // Documents already on this device are still readable and searchable —
  // this is not a blocking spinner over the whole UI.
  const search = page.locator('input[type="search"]');
  await search.fill(PENDING_STRUCTURE_DOCS[0]);
  const hit = page.locator('.search-popup .panel li.result', {
    hasText: PENDING_STRUCTURE_DOCS[0],
  });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page.getByRole('heading', { name: PENDING_STRUCTURE_DOCS[0] })).toBeVisible();
  await expect(page.locator('.body')).toContainText('treasurer presented the budget');
});

test('once the tree resolves on a reconcile, the banner clears and folders populate — no manual reload', async ({
  page,
}) => {
  await page.goto(PENDING);
  await expect(page.locator(banner)).toBeVisible();

  await page.evaluate(() => (window as any).__ARK_RESOLVE_TREE__());
  // Mirrors SignalStore's focus-triggered backstop reconcile — no page
  // reload, no re-navigation, just the same event production code listens
  // for on every tab refocus.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect(page.locator(banner)).toHaveCount(0);
  await expect(
    page.locator(`sl-tree-item[data-kind="folder"][data-name="${PENDING_STRUCTURE_FOLDER}"]`),
  ).toBeVisible();

  // Still nothing genuinely unfiled — both documents' filings resolved to
  // the now-known folder.
  await expect(page.locator('section', { hasText: 'Unfiled' })).toHaveCount(0);

  await page
    .locator(`sl-tree-item[data-kind="folder"][data-name="${PENDING_STRUCTURE_FOLDER}"] > .row .name`)
    .click();
  await expect(page.locator('sl-tree-item[data-kind="doc"]')).toHaveCount(
    PENDING_STRUCTURE_DOCS.length,
  );
});
