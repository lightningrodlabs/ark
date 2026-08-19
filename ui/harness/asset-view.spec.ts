import { test, expect } from '@playwright/test';
import { ASSET_DOCUMENT_TITLE, ASSET_DOCUMENT_BODY_TEXT } from './seed';

// The Moss asset-rendering path: `?asset=plain`/`?asset=rendered` (see
// harness-main.ts) seeds one document and mounts App.svelte with
// `__ARK_TEST_ASSET__` set, standing in for `weaveClient.renderInfo.view.wal`
// inside real Moss. What matters most here is not just what renders, but
// what does NOT run — an asset view must fetch exactly one document, never
// boot the tree/store/search apparatus that indexes the whole corpus.

for (const asset of ['plain', 'rendered'] as const) {
  test(`asset view (${asset}) renders the document's markdown read-only, with nothing else`, async ({
    page,
  }) => {
    await page.goto(`/harness/index.html?asset=${asset}`);

    await expect(page.getByRole('heading', { name: ASSET_DOCUMENT_TITLE })).toBeVisible();
    await expect(page.locator('.body')).toContainText(ASSET_DOCUMENT_BODY_TEXT);
    await expect(page.locator('.date')).toHaveText('2026-01-15');

    // No tree, no search, no toolbar, no editor — the app never boots.
    await expect(page.locator('sl-tree')).toHaveCount(0);
    await expect(page.locator('.search')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New document' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Import' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Amend' })).toHaveCount(0);

    // The property that matters most: fetching one document must not have
    // pulled in the whole corpus. See stub-client.ts's `calls` and the
    // "must not boot the app" note in the moss-assets dispatch brief.
    const calls = await page.evaluate(() => (window as unknown as { __ARK_ZOME_CALLS__: string[] }).__ARK_ZOME_CALLS__);
    expect(calls).not.toContain('get_all_documents');
    expect(calls).toContain('get_document');
  });
}

test('asset view shows a plain message for a document that no longer resolves', async ({ page }) => {
  // `?asset=missing` (see harness-main.ts) points __ARK_TEST_ASSET__ at a
  // hash the stub has never heard of — the same shape a trashed or
  // not-yet-synced document produces for a real WAL in Moss.
  await page.goto('/harness/index.html?asset=missing');

  await expect(page.locator('.missing')).toHaveText('This document is no longer available.');
  await expect(page.locator('sl-tree')).toHaveCount(0);

  const calls = await page.evaluate(() => (window as unknown as { __ARK_ZOME_CALLS__: string[] }).__ARK_ZOME_CALLS__);
  expect(calls).not.toContain('get_all_documents');
});
