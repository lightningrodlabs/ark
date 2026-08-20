import { test, expect } from '@playwright/test';
import {
  ASSET_DOCUMENT_TITLE,
  ASSET_DOCUMENT_BODY_TEXT,
  ASSET_TEXT_ATTACHMENT_NAME,
  ASSET_TEXT_ATTACHMENT_CONTENT,
  ASSET_IMAGE_ATTACHMENT_NAME,
} from './seed';
import { createDocument } from './helpers';

// The Moss asset-rendering path: `?asset=plain`/`?asset=rendered` (see
// harness-main.ts) seeds one document and mounts App.svelte with
// `__ARK_TEST_ASSET__` set, standing in for `weaveClient.renderInfo.view.wal`
// inside real Moss. What matters most here is not just what renders, but
// what does NOT run — an asset view must fetch exactly one document, never
// boot the tree/store/search apparatus that indexes the whole corpus.

// `rendered` is no longer something ark writes — that second pocket view was
// removed, because it rendered through this same component and was
// indistinguishable once opened. It stays in this loop as the compatibility
// case: pocket items saved before the removal still carry that context and
// must still render.
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

    // Neither optional section renders for a document with no attachments
    // and only one version.
    await expect(page.getByRole('heading', { name: 'Attachments' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Versions' })).toHaveCount(0);

    // The property that matters most: fetching one document must not have
    // pulled in the whole corpus. See stub-client.ts's `calls` and the
    // "must not boot the app" note in the moss-assets dispatch brief.
    // `create_document` is only the harness seeding the fixture before the
    // app mounts (see seed.ts's `seedAssetDocument`), not something the
    // asset view itself does. Attachments and version history each add one
    // more single-document call, which is fine.
    const calls = await page.evaluate(() => (window as unknown as { __ARK_ZOME_CALLS__: string[] }).__ARK_ZOME_CALLS__);
    expect(calls).not.toContain('get_all_documents');
    expect(calls).toContain('get_document');
    expect(calls).toContain('get_attachments');
    expect(calls).toContain('get_document_versions');
  });
}

test('asset view shows and previews a text attachment', async ({ page }) => {
  await page.goto('/harness/index.html?asset=attachment-text');

  await expect(page.getByRole('heading', { name: ASSET_DOCUMENT_TITLE })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Attachments' })).toBeVisible();
  const row = page.locator('li', { hasText: ASSET_TEXT_ATTACHMENT_NAME });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Preview' }).click();
  await expect(row.locator('pre')).toContainText(ASSET_TEXT_ATTACHMENT_CONTENT.split('\n')[0]);

  // No versions here — only the attachment.
  await expect(page.getByRole('heading', { name: 'Versions' })).toHaveCount(0);

  const calls = await page.evaluate(() => (window as unknown as { __ARK_ZOME_CALLS__: string[] }).__ARK_ZOME_CALLS__);
  expect(calls).not.toContain('get_all_documents');
});

test('asset view shows and previews an image attachment', async ({ page }) => {
  await page.goto('/harness/index.html?asset=attachment-image');

  await expect(page.getByRole('heading', { name: 'Attachments' })).toBeVisible();
  const row = page.locator('li', { hasText: ASSET_IMAGE_ATTACHMENT_NAME });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /preview/i }).click();

  // Asserting the element exists is not enough — a dead blob src still
  // yields an <img>. naturalWidth is only non-zero once the bytes have
  // actually decoded (see attachments.spec.ts's image-preview regression).
  const img = page.locator('img');
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 5000 })
    .toBeGreaterThan(0);
});

test('asset view shows version history for a document with more than one version', async ({ page }) => {
  await page.goto('/harness/index.html?asset=versions');

  await expect(page.getByRole('heading', { name: 'Versions' })).toBeVisible();
  await expect(page.locator('.history li')).toHaveCount(2);

  // No attachments on this document.
  await expect(page.getByRole('heading', { name: 'Attachments' })).toHaveCount(0);
});

test('the asset view offers no Remove button and no upload input, unlike the main document view', async ({
  page,
}) => {
  await page.goto('/harness/index.html?asset=attachment-text');
  await expect(page.locator('li', { hasText: ASSET_TEXT_ATTACHMENT_NAME })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  // The main document view, by contrast, still offers both — this is a
  // read-only property of the asset view specifically, not a regression in
  // Attachments.svelte itself.
  await page.goto('/harness/index.html');
  await createDocument(page, { title: 'Budget meeting', body: 'See attached budget.' });
  await page.setInputFiles('input[type="file"]', {
    name: 'budget.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('item,amount\nCoffee,4.50\n'),
  });
  await expect(page.locator('li', { hasText: 'budget.csv' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
});

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
