import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { createDocument, createRootFolder, selectFolder } from './helpers';
import { COMMITTEES, TOTAL_DOCUMENTS } from './seed';

// The About dialog is the app's one door to version info, import and export.
// These run the real component tree against the in-memory stub (see
// stub-client.ts), so "Export produces a zip" is asserted on the bytes the
// browser was actually handed, not on a mock.

test('the archive-box button opens About, showing a version and a DNA hash', async ({ page }) => {
  await page.goto('/harness/index.html');
  await expect(page.getByRole('button', { name: 'New document' })).toBeVisible();

  await expect(page.locator('[data-testid="about-dialog"]')).not.toBeVisible();
  await page.locator('sl-icon-button.about').click();

  const dialog = page.locator('[data-testid="about-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-testid="about-version"]')).toHaveText(/^ark \d+\.\d+\.\d+$/);
  // A real base64 hash, truncated for display — not the "unavailable" fallback.
  await expect(dialog.locator('[data-testid="about-dna"]')).toHaveText(/…/);
  await expect(dialog.locator('[data-testid="about-agent"]')).toHaveText(/…/);
});

test('Import is reached from the dialog, and has no toolbar button of its own', async ({ page }) => {
  await page.goto('/harness/index.html');
  await expect(page.getByRole('button', { name: 'New document' })).toBeVisible();

  // The old trigger is gone: the only "Import" control is inside the dialog.
  await expect(page.locator('.toolbar button.import')).toHaveCount(0);

  await page.locator('sl-icon-button.about').click();
  await page.getByRole('button', { name: 'Import…' }).click();

  await expect(page.getByRole('heading', { name: 'Import markdown' })).toBeVisible();
  await expect(page.locator('[data-testid="about-dialog"]')).not.toBeVisible();
  // And the panel can still be closed the way it always could.
  await expect(page.locator('.toolbar button.import')).toHaveText('Close import');
});

test('Export writes a zip the browser can save, holding the archive', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Finance and Legal');
  await selectFolder(page, 'Finance and Legal');
  await createDocument(page, {
    title: 'Café budget review',
    body: 'The treasurer presented the budget.',
    date: '2014-03-04',
  });

  await page.locator('sl-icon-button.about').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-testid="about-export"]').click();

  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/^ark-archive-\d{4}-\d{2}-\d{2}\.zip$/);

  const bytes = readFileSync(await saved.path());
  expect(bytes.length).toBeGreaterThan(0);
  const entries = unzipSync(new Uint8Array(bytes));
  const paths = Object.keys(entries);
  expect(paths).toEqual(['Finance and Legal/Café budget review.md']);
  const text = strFromU8(entries[paths[0]]);
  expect(text).toContain('title: "Café budget review"');
  expect(text).toContain('folder: "Finance and Legal"');
  expect(text).toContain('The treasurer presented the budget.');

  // And the dialog says what it wrote, since a download is easy to miss.
  await expect(page.locator('[data-testid="about-export-result"]')).toContainText('1 document');
});

// The corpus this tool exists for is 1406 documents. An export that quietly
// wrote 100 of them, or wedged the UI for a minute, would be worse than no
// export at all, so the real size is exercised rather than assumed.
test('Export covers the whole reference archive without truncating it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/harness/index.html?seed=archive');
  await expect(page.locator('sl-tree-item[data-kind="folder"]')).toHaveCount(COMMITTEES, {
    timeout: 60_000,
  });

  await page.locator('sl-icon-button.about').click();
  const started = Date.now();
  const download = page.waitForEvent('download');
  await page.locator('[data-testid="about-export"]').click();
  const saved = await download;
  const elapsed = Date.now() - started;

  const entries = unzipSync(new Uint8Array(readFileSync(await saved.path())));
  const paths = Object.keys(entries);
  console.log(
    `[scale] export of ${TOTAL_DOCUMENTS} documents: ${elapsed}ms, ` +
      `${paths.length} files, ${(readFileSync(await saved.path()).length / 1024).toFixed(0)} KB`,
  );

  // Every document, none lost to a same-title collision inside a committee.
  expect(paths).toHaveLength(TOTAL_DOCUMENTS);
  expect(new Set(paths).size).toBe(TOTAL_DOCUMENTS);
  await expect(page.locator('[data-testid="about-export-result"]')).toContainText(
    `${TOTAL_DOCUMENTS} documents`,
  );
});
