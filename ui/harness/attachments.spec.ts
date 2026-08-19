import { test, expect } from '@playwright/test';
import { createDocument } from './helpers';

// Bug: "there is no way to view or download an attachment."
//
// Attachments.svelte used to open a `blob:` URL with `window.open(url)`.
// Moss's setWindowOpenHandler denies every window.open call except
// http(s):// and weave deep links (see docs/dev/fix-brief-template.md), so
// the click did nothing — same bug class as window.prompt. This spec drives
// the two fixed affordances: an inline preview (text/image, decoded and
// shown in the document, never touching window.open) and a programmatic
// <a download> click for anything else.

test('attaching a .csv file lists it as an attachment', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createDocument(page, { title: 'Budget meeting', body: 'See attached budget.' });

  await page.setInputFiles('input[type="file"]', {
    name: 'budget.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('item,amount\nCoffee,4.50\nPaper,12.00\n'),
  });

  await expect(page.locator('li', { hasText: 'budget.csv' })).toBeVisible();
});

test('previewing a text attachment shows its contents inline, and closing the preview hides them', async ({
  page,
}) => {
  await page.goto('/harness/index.html');
  await createDocument(page, { title: 'Budget meeting', body: 'See attached budget.' });

  await page.setInputFiles('input[type="file"]', {
    name: 'budget.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('item,amount\nCoffee,4.50\nPaper,12.00\n'),
  });

  const row = page.locator('li', { hasText: 'budget.csv' });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Preview' }).click();
  await expect(row.locator('pre')).toContainText('Coffee,4.50');

  await row.getByRole('button', { name: 'Hide preview' }).click();
  await expect(row.locator('pre')).toHaveCount(0);
});

test('a non-previewable attachment offers download instead of preview', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createDocument(page, { title: 'Board packet', body: 'See attached roster.' });

  await page.setInputFiles('input[type="file"]', {
    name: 'roster.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake pdf bytes'),
  });

  const row = page.locator('li', { hasText: 'roster.pdf' });
  await expect(row).toBeVisible();

  await expect(row.getByRole('button', { name: 'Preview' })).toHaveCount(0);
  await expect(row).toContainText('cannot be previewed');
  await expect(row.getByRole('button', { name: 'Download' })).toBeVisible();
});

test('downloading an attachment triggers a real browser download with the right filename', async ({
  page,
}) => {
  await page.goto('/harness/index.html');
  await createDocument(page, { title: 'Board packet', body: 'See attached roster.' });

  await page.setInputFiles('input[type="file"]', {
    name: 'roster.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake pdf bytes'),
  });

  const row = page.locator('li', { hasText: 'roster.pdf' });
  await expect(row).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('roster.pdf');
});

test('previewing an image attachment actually renders the image', async ({ page }) => {
  // Regression: the preview <img> appeared but its blob URL 404'd with
  // ERR_FILE_NOT_FOUND. The $effect that clears a stale preview called
  // closePreview(), which READS previewUrl — so the effect tracked it, re-ran
  // the moment togglePreview assigned a new URL, and revoked that URL
  // immediately. Text previews hold no URL and so were unaffected, which is
  // why only images broke and no spec caught it.
  //
  // Asserting the element exists is NOT enough: a dead blob src still yields an
  // <img>. naturalWidth is only non-zero once the bytes have actually decoded.
  await page.goto('/harness/index.html');
  await createDocument(page, { title: 'Site photos', body: 'Roof inspection.' });

  // A 1x1 PNG — smallest thing that still proves the bytes round-tripped
  // through file storage, the blob URL, and the decoder.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.setInputFiles('input[type="file"]', {
    name: 'roof.png',
    mimeType: 'image/png',
    buffer: png,
  });

  const row = page.locator('li', { hasText: 'roof.png' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /preview/i }).click();

  const img = page.locator('img');
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 5000 })
    .toBeGreaterThan(0);
});
