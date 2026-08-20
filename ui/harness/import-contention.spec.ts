import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Two ways a long import and the rest of the app fight each other, both
// reported from the same real run: 1406 documents imported, and the progress
// count freezing.
//
// 1. The five-minute reconcile is not suppressed while an import runs. It sees
//    that the corpus moved — the import moved it — and re-fetches, serialised
//    against the import's own writes on the same cell.
// 2. The import's closing refresh re-pages the WHOLE corpus with the button
//    still reading `N/N`, so the UI looks finished and hung. (Next commit.)

const IMPORT_DOCS = 8;
let importDir: string;

function writeMinutes(dir: string, count: number, prefix: string): void {
  for (let i = 0; i < count; i++) {
    writeFileSync(
      join(dir, `${prefix}-${i}.md`),
      `---\ntitle: ${prefix} minutes ${i}\ndate: 2015-05-${String(i + 1).padStart(2, '0')}\nfolder: Finance\n---\n\nThe treasurer reported item ${i}.\n`,
    );
  }
}

test.beforeAll(() => {
  importDir = mkdtempSync(join(tmpdir(), 'ark-contention-'));
  writeMinutes(importDir, IMPORT_DOCS, 'run');
});
test.afterAll(() => rmSync(importDir, { recursive: true, force: true }));

/** Open the import panel the only way the app offers: through About. */
async function openImport(page: Page): Promise<void> {
  await page.locator('sl-icon-button.about').click();
  await page.getByRole('button', { name: 'Import…' }).click();
}

/** The panel's one button — progress label while a run is in flight. */
const importButton = (page: Page) => page.locator('.pane-end section > button');

/** Every zome fn the stub has been asked for, in order (see harness-main.ts). */
const zomeCalls = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...((window as any).__ARK_ZOME_CALLS__ as string[])]);

const countOf = async (page: Page, fn: string): Promise<number> =>
  (await zomeCalls(page)).filter((c) => c === fn).length;

const stall = (page: Page, fn: string) =>
  page.evaluate((name) => (window as any).__ARK_STALL__(name), fn);
const releaseAll = (page: Page) => page.evaluate(() => (window as any).__ARK_RELEASE__());

async function pickAndPlan(page: Page, dir: string, expected: number): Promise<void> {
  await page.setInputFiles('.pane-end input[type="file"]', dir);
  await expect(page.locator('.pane-end .summary')).toContainText(`${expected} new document`);
}

// ---------------------------------------------------------------------------
// 1. The reconcile timer must not run during an import.
// ---------------------------------------------------------------------------

// `focus` is the reconcile path a test can fire on demand; the five-minute
// timer takes the identical route through `reconcile()`, and the sweep — the
// most expensive tick of all — is guarded in the same place.
test('a reconcile firing during an import touches the cell not at all', async ({ page }) => {
  await page.goto('/harness/index.html');
  await expect(page.getByRole('button', { name: 'New document' })).toBeVisible();
  await openImport(page);
  await pickAndPlan(page, importDir, IMPORT_DOCS);

  // Hold every create_document, so the import is genuinely mid-run rather
  // than racing a stub that answers in microtasks.
  await stall(page, 'create_document');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(importButton(page)).toHaveText(`Importing 0/${IMPORT_DOCS}…`);

  const before = await zomeCalls(page);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  // Long enough for the whole reconcile chain to have run against this stub,
  // which answers in microtasks.
  await page.waitForTimeout(200);

  // Not "no full reload" — no zome call whatsoever. changedSince() alone is
  // two round trips against a cell the import is writing to.
  expect(await zomeCalls(page)).toEqual(before);

  // And the import is undisturbed by the tick that did not happen.
  await releaseAll(page);
  await expect(page.locator('.pane-end .result')).toContainText(
    `${IMPORT_DOCS} document(s) created`,
  );
});

// The other half of the guarantee: suppression is temporary. Once the run is
// over, the ordinary backstop has to work exactly as before.
test('the reconcile resumes as soon as the import is over', async ({ page }) => {
  await page.goto('/harness/index.html');
  await expect(page.getByRole('button', { name: 'New document' })).toBeVisible();
  await openImport(page);
  await pickAndPlan(page, importDir, IMPORT_DOCS);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.pane-end .result')).toContainText(
    `${IMPORT_DOCS} document(s) created`,
  );

  const before = await countOf(page, 'get_all_documents');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(() => countOf(page, 'get_all_documents'))
    .toBeGreaterThan(before);
});
