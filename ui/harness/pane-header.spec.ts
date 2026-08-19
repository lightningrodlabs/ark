import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDocument, createRootFolder, openDocument, selectFolder } from './helpers';

// The right-hand pane had four occupants and no shared frame around any of
// them: a document could never be closed (only replaced), and nothing on
// screen said what the pane was showing. Opening Import from the About
// dialog therefore looked like the button had failed — the panel took over
// the place documents live, unannounced. One sticky header, the same for
// every occupant, fixes both.

const header = (page: Page) => page.locator('[data-testid="pane-header"]');
const title = (page: Page) => page.locator('[data-testid="pane-title"]');
const close = (page: Page) => page.locator('[data-testid="pane-close"]');
const hint = (page: Page) => page.locator('.pane-end .hint');

/** A folder with one document in it, left open in the pane. */
async function seedOpenDocument(page: Page, docTitle: string, body: string): Promise<void> {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  await createDocument(page, { title: docTitle, body });
}

/**
 * A folder of invented minutes on disk. The import input is
 * `webkitdirectory`, which Playwright can only fill from a real directory
 * path — a Buffer fixture (what every other spec here uses) is rejected.
 */
let importDir: string;
test.beforeAll(() => {
  importDir = mkdtempSync(join(tmpdir(), 'ark-import-'));
  writeFileSync(
    join(importDir, 'one.md'),
    '---\ntitle: March minutes\ndate: 2014-03-04\nfolder: Finance\n---\n\nThe treasurer reported.\n',
  );
  writeFileSync(
    join(importDir, 'two.md'),
    '---\ntitle: April minutes\ndate: 2014-04-04\nfolder: Finance\n---\n\nThe roof was discussed.\n',
  );
});
test.afterAll(() => rmSync(importDir, { recursive: true, force: true }));

/** Open the import panel the only way the app offers: through About. */
async function openImport(page: Page): Promise<void> {
  await page.locator('sl-icon-button.about').click();
  await page.getByRole('button', { name: 'Import…' }).click();
}

test('an open document names itself in the pane header and can be closed', async ({ page }) => {
  await seedOpenDocument(page, 'Annual Meeting', 'We approved the budget.');

  await expect(title(page)).toHaveText('Annual Meeting');
  await close(page).click();

  await expect(hint(page)).toBeVisible();
  await expect(header(page)).toHaveCount(0);
  await expect(page.locator('.pane-end .body')).toHaveCount(0);
});

test('closing a document and opening another shows the second, not a stale first', async ({
  page,
}) => {
  await seedOpenDocument(page, 'First minutes', 'The first body.');
  await selectFolder(page, 'Board Minutes');
  await createDocument(page, { title: 'Second minutes', body: 'The second body.' });

  await openDocument(page, 'First minutes');
  await expect(title(page)).toHaveText('First minutes');
  await close(page).click();
  await expect(hint(page)).toBeVisible();

  await openDocument(page, 'Second minutes');
  await expect(title(page)).toHaveText('Second minutes');
  await expect(page.locator('.pane-end .body')).toContainText('The second body.');
  await expect(page.locator('.pane-end .body')).not.toContainText('The first body.');
});

test('the import panel says what it is, and closing it leaves the pane empty', async ({ page }) => {
  await seedOpenDocument(page, 'Annual Meeting', 'We approved the budget.');
  await expect(title(page)).toHaveText('Annual Meeting');

  await openImport(page);
  // The whole reported confusion: the pane now holds something else, and it
  // has to say so.
  await expect(title(page)).toHaveText('Import markdown');
  await expect(page.locator('.pane-end input[type="file"]')).toBeVisible();

  await close(page).click();
  // Empty, not the document that was open before Import took the pane.
  await expect(hint(page)).toBeVisible();
  await expect(page.locator('.pane-end .body')).toHaveCount(0);
});

test('the editor names itself for both create and amend', async ({ page }) => {
  await seedOpenDocument(page, 'Annual Meeting', 'We approved the budget.');

  await page.getByRole('button', { name: 'Amend' }).click();
  await expect(title(page)).toHaveText('Amend Annual Meeting');

  await page.getByRole('button', { name: 'New document' }).click();
  await expect(title(page)).toHaveText('New document');
});

test('the close button is disabled while an import is actually running', async ({ page }) => {
  await page.goto('/harness/index.html');
  await expect(page.getByRole('button', { name: 'New document' })).toBeVisible();
  await openImport(page);

  // Before the run starts, closing is fine.
  await expect(close(page)).toBeEnabled();

  await page.setInputFiles('.pane-end input[type="file"]', importDir);
  await expect(page.locator('.pane-end .summary')).toContainText('2');

  // Hold every create_document open so the run is genuinely in flight while
  // the assertion below runs, rather than racing an in-memory stub.
  await page.evaluate(() => (window as any).__ARK_STALL__('create_document'));
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  await expect(close(page)).toBeDisabled();
  await expect(close(page)).toHaveAttribute('title', /import/i);

  // The toolbar's "Close import" is the same close by another door, and has
  // to be shut for the same reason.
  await expect(page.locator('.toolbar button.import')).toBeDisabled();

  await page.evaluate(() => (window as any).__ARK_RELEASE__());
  await expect(page.locator('.pane-end .result')).toContainText('2 document(s) created');
  // And once it has finished, closing is fine again — by either door.
  await expect(close(page)).toBeEnabled();
  await expect(page.locator('.toolbar button.import')).toBeEnabled();
});

test('Escape closes an open document', async ({ page }) => {
  await seedOpenDocument(page, 'Annual Meeting', 'We approved the budget.');
  await expect(title(page)).toHaveText('Annual Meeting');

  await page.keyboard.press('Escape');
  await expect(hint(page)).toBeVisible();
});

test('Escape during an edit does not throw the edit away', async ({ page }) => {
  await seedOpenDocument(page, 'Annual Meeting', 'We approved the budget.');
  await page.getByRole('button', { name: 'Amend' }).click();
  await page.locator('.pane-end textarea').fill('Half-written amendment.');

  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveText('Amend Annual Meeting');
  await expect(page.locator('.pane-end textarea')).toHaveValue('Half-written amendment.');
});

test('closing a dirty edit asks first, and closing a clean one does not', async ({ page }) => {
  await seedOpenDocument(page, 'Annual Meeting', 'We approved the budget.');

  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });

  // Clean: opened and closed without touching anything.
  await page.getByRole('button', { name: 'Amend' }).click();
  await close(page).click();
  await expect(hint(page)).toBeVisible();
  expect(asked).toEqual([]);

  // Dirty: the confirm is dismissed, so the edit survives.
  await openDocument(page, 'Annual Meeting');
  await page.getByRole('button', { name: 'Amend' }).click();
  await page.locator('.pane-end textarea').fill('Half-written amendment.');
  await close(page).click();
  await expect(page.locator('.pane-end textarea')).toHaveValue('Half-written amendment.');
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatch(/discard/i);
});

// Minutes run long and the pane scrolls (App.svelte's `.pane { overflow:
// auto }`), so the close button has to stay reachable. Sticky positioning is
// the mechanism; these assert the outcome — the header pinned to the top of
// the scrolled pane, and opaque, so the body does not show through it and
// its text keeps subpixel antialiasing inside Moss's iframe.
test('the header stays pinned to the top of a scrolled pane, and is opaque', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  const long = Array.from({ length: 200 }, (_, i) => `Paragraph ${i} of a long set of minutes.`).join(
    '\n\n',
  );
  await createDocument(page, { title: 'A very long set of minutes', body: long });

  const pane = page.locator('.pane-end');
  await pane.evaluate((el) => el.scrollTo(0, 4000));
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);

  const paneBox = await pane.boundingBox();
  const headerBox = await header(page).boundingBox();
  expect(headerBox).not.toBeNull();
  // Still on screen, still at the very top of the pane, not scrolled away.
  expect(Math.abs(headerBox!.y - paneBox!.y)).toBeLessThan(1);
  await expect(close(page)).toBeVisible();

  const background = await header(page).evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(background).not.toBe('transparent');
  expect(background).not.toMatch(/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/);
});

// The editor used to be `height: 100%` of the pane. With a header above it
// that is exactly one header too tall, and dropping the rule entirely would
// have collapsed the textarea to its 20rem minimum instead.
test('the editor still fills the pane below the header', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  await page.getByRole('button', { name: 'New document' }).click();

  const pane = await page.locator('.pane-end').boundingBox();
  const headerBox = await header(page).boundingBox();
  const editor = await page.locator('.pane-end .editor').boundingBox();
  // Fills the space the header leaves, to within a pixel — no gap, and no
  // overflow that would put a scrollbar on an empty editor.
  expect(Math.abs(editor!.height - (pane!.height - headerBox!.height))).toBeLessThan(2);
  await expect
    .poll(() => page.locator('.pane-end').evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeLessThan(2);
});
