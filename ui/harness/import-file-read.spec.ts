import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { READ_CONCURRENCY } from '../src/import/read-files';

// Importing the real archive in live Moss 0.15.8 died with
//
//   Uncaught (in promise) NotReadableError: The requested file could not be
//   read, typically due to permission problems that have occurred after a
//   reference to a file was acquired.
//
// and the user saw NOTHING: "after choosing the file to import I see the
// number 4251, but the next step never happens." 4251 is the file input's own
// count of picked files. `choose()` is an async onchange handler with no error
// handling, so its rejection escaped, `plan` was never assigned, and the panel
// simply sat there.
//
// Two bugs, covered separately below. The trigger is the count: a smaller
// subset of the same folder imports fine in live Moss, so the eager
// `Promise.all` over every picked markdown file is what kills it, and the reads
// have to be bounded. And whatever fails next, a failed read must be reported
// by name, must not take the rest of the import with it, and must never leave
// the panel looking like nothing happened.
//
// The harness supplies the failure (see harness-main.ts): a name pattern whose
// reads reject with exactly that DOMException, plus a peak-concurrency counter
// for the eager markdown reads.

let goodDir: string;
let brokenDir: string;
let manyDir: string;
let attachmentDir: string;

/** Enough files that an unbounded read is unmistakably unbounded. */
const MANY = 120;

function writeMinutes(dir: string, name: string, body: string, attachment?: string): void {
  const attachments = attachment ? `attachments:\n  - "${attachment}"\n` : '';
  writeFileSync(
    join(dir, name),
    `---\ntitle: ${name.replace(/\.md$/, '')}\ndate: 2015-05-01\nfolder: Finance\n${attachments}---\n\n${body}\n`,
  );
}

test.beforeAll(() => {
  goodDir = mkdtempSync(join(tmpdir(), 'ark-read-good-'));
  brokenDir = mkdtempSync(join(tmpdir(), 'ark-read-broken-'));
  manyDir = mkdtempSync(join(tmpdir(), 'ark-read-many-'));
  attachmentDir = mkdtempSync(join(tmpdir(), 'ark-read-attach-'));

  for (let i = 0; i < 3; i++) writeMinutes(goodDir, `fine-${i}.md`, `Item ${i}.`);

  // One file among several that the harness will refuse to read.
  writeMinutes(brokenDir, 'unreadable.md', 'Never read.');
  for (let i = 0; i < 3; i++) writeMinutes(brokenDir, `readable-${i}.md`, `Item ${i}.`);

  for (let i = 0; i < MANY; i++) writeMinutes(manyDir, `bulk-${i}.md`, `Item ${i}.`);

  writeMinutes(attachmentDir, 'with-budget.md', 'See the budget.', 'budget.txt');
  writeFileSync(join(attachmentDir, 'budget.txt'), 'the numbers');
});

test.afterAll(() => {
  for (const dir of [goodDir, brokenDir, manyDir, attachmentDir]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Open the import panel the only way the app offers: through About. */
async function openImport(page: Page): Promise<void> {
  await page.locator('sl-icon-button.about').click();
  await page.getByRole('button', { name: 'Import…' }).click();
}

/**
 * Every uncaught error AND every unhandled rejection the page produces.
 *
 * Both, deliberately: an async `onchange` handler that rejects is an unhandled
 * rejection, which is the exact shape of this bug, and `pageerror` alone is not
 * guaranteed to carry one.
 */
async function collectPageErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.exposeFunction('__arkReportRejection', (message: string) =>
    errors.push(`unhandledrejection: ${message}`),
  );
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const report = (window as unknown as { __arkReportRejection?: (m: string) => void })
        .__arkReportRejection;
      report?.(String(event.reason));
    });
  });
  return errors;
}

const failReads = (page: Page, pattern: string | null) =>
  page.evaluate(
    (p) => (window as any).__ARK_FAIL_FILE_READS__(p),
    pattern,
  );

const readStats = (page: Page): Promise<{ peak: number; total: number }> =>
  page.evaluate(() => ({ ...(window as any).__ARK_FILE_READS__ }));

async function boot(page: Page): Promise<void> {
  await page.goto('/harness/index.html');
  await expect(page.getByRole('button', { name: 'New document' })).toBeVisible();
  await openImport(page);
}

const panel = (page: Page) => page.locator('.pane-end section');

// ---------------------------------------------------------------------------
// 1. A read that fails is reported, by name, and costs only its own file.
// ---------------------------------------------------------------------------

test('a markdown file that cannot be read is named in the panel, and the rest still import', async ({
  page,
}) => {
  const errors = await collectPageErrors(page);
  await boot(page);
  await failReads(page, 'unreadable\\.md$');

  await page.setInputFiles('.pane-end input.pick-folder', brokenDir);

  // Named, not merely counted: with 1406 picked files a bare "1 failed" is
  // useless to whoever has to go find it.
  await expect(panel(page).locator('.failed-list')).toContainText('unreadable.md');
  // And the three that read fine are planned, not lost with it.
  await expect(panel(page).locator('.summary')).toContainText('3 new document');

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(panel(page).locator('.result')).toContainText('3 document(s) created');

  expect(errors).toEqual([]);
});

// The whole visible symptom, as its own assertion: pick files, and something
// happens. Before the fix this panel showed the input's file count and nothing
// else, forever.
//
// A clean sweep is also reported differently from a single bad file, because
// it is a different problem with a different owner: a file versus the
// environment.
test('picking files whose reads all fail still leaves the panel saying so', async ({ page }) => {
  const errors = await collectPageErrors(page);
  await boot(page);
  await failReads(page, '\\.md$');

  await page.setInputFiles('.pane-end input.pick-folder', goodDir);

  await expect(panel(page)).toContainText('None of the 3 markdown file(s) attempted');
  await expect(panel(page)).toContainText('points at this environment');
  await expect(panel(page).locator('.failed-list')).toContainText('fine-0.md');
  await expect(panel(page).locator('.failed-list li')).toHaveCount(3);
  expect(errors).toEqual([]);
});

// The other side of that fork: one bad file among many must NOT be reported as
// an environment failure — `go()` clears the picked files when a run finishes,
// which is exactly when a derived "nothing read" would flip on by itself.
test('one bad file among many is never reported as an environment failure', async ({ page }) => {
  const errors = await collectPageErrors(page);
  await boot(page);
  await failReads(page, 'unreadable\\.md$');

  await page.setInputFiles('.pane-end input.pick-folder', brokenDir);
  await expect(panel(page).locator('.failed-list')).toContainText('unreadable.md');
  await expect(panel(page)).not.toContainText('points at this environment');

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(panel(page).locator('.result')).toContainText('3 document(s) created');
  await expect(panel(page)).not.toContainText('points at this environment');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// 2. The eager reads are bounded.
// ---------------------------------------------------------------------------

// The fix for the reported failure. `Promise.all` over every picked markdown
// file starts all of them in one tick — ~1409 of them on the real archive, and
// a smaller subset of that same folder imports fine. With MANY files an
// unbounded implementation peaks at MANY; a pooled one peaks at
// READ_CONCURRENCY.
test('markdown reads are pooled rather than all started at once', async ({ page }) => {
  const errors = await collectPageErrors(page);
  await boot(page);

  await page.setInputFiles('.pane-end input.pick-folder', manyDir);
  await expect(panel(page).locator('.summary')).toContainText(`${MANY} new document`);

  const stats = await readStats(page);
  expect(stats.total).toBe(MANY);
  expect(stats.peak).toBeLessThanOrEqual(READ_CONCURRENCY);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// 3. An attachment whose read fails loses the attachment, never the document.
// ---------------------------------------------------------------------------

// Attachment `File` handles are read minutes after they were acquired — long
// after the markdown was — so they are the most exposed read in the whole path.
// The existing contract is that a failed attachment is reported and the
// document is still created; this holds it to that when the failure is in the
// READ rather than in the upload.
test('an attachment that cannot be read is reported and the document is still created', async ({
  page,
}) => {
  const errors = await collectPageErrors(page);
  await boot(page);

  await page.setInputFiles('.pane-end input.pick-folder', attachmentDir);
  await expect(panel(page).locator('.summary')).toContainText('1 new document');

  // Fail the attachment only, and only once the markdown has been read.
  await failReads(page, 'budget\\.txt$');
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  await expect(panel(page).locator('.result')).toContainText('1 document(s) created');
  await expect(panel(page).locator('.result')).toContainText('0 attachment(s) uploaded');
  await expect(panel(page).locator('.failed-list')).toContainText('budget.txt');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// 4. Picking individual files, not only a folder.
// ---------------------------------------------------------------------------

// `webkitdirectory` makes a file input directory-ONLY, so the panel offered no
// way to import a single document — and no way to narrow down a folder that
// would not import, which is exactly the diagnostic the user reached for when
// this failed. The two routes cannot share one input, so there are two, and
// both go through the same plan and the same import.

test('a single markdown file can be picked and imported on its own', async ({ page }) => {
  const errors = await collectPageErrors(page);
  await boot(page);

  await page.setInputFiles('.pane-end input.pick-files', join(goodDir, 'fine-0.md'));

  await expect(panel(page).locator('.summary')).toContainText('1 new document');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(panel(page).locator('.result')).toContainText('1 document(s) created');
  expect(errors).toEqual([]);
});

test('a hand-picked document and its attachment still match up', async ({ page }) => {
  // Individually picked files have an EMPTY `webkitRelativePath`, so the
  // same-directory preference matchAttachments applies to a folder pick has
  // nothing to work with. It must still match on the plain name rather than
  // silently attaching nothing — or, worse, the wrong file.
  const errors = await collectPageErrors(page);
  await boot(page);

  await page.setInputFiles('.pane-end input.pick-files', [
    join(attachmentDir, 'with-budget.md'),
    join(attachmentDir, 'budget.txt'),
  ]);

  await expect(panel(page).locator('.summary')).toContainText('1 document(s) with a matched attachment');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(panel(page).locator('.result')).toContainText('1 attachment(s) uploaded');
  expect(errors).toEqual([]);
});

test('picking files replaces a folder pick rather than adding to it', async ({ page }) => {
  // Two inputs means two file lists, and the one the user did not just use
  // must not go on advertising a stale count next to somebody else's plan.
  const errors = await collectPageErrors(page);
  await boot(page);

  await page.setInputFiles('.pane-end input.pick-folder', manyDir);
  await expect(panel(page).locator('.summary')).toContainText(`${MANY} new document`);

  await page.setInputFiles('.pane-end input.pick-files', join(goodDir, 'fine-1.md'));
  await expect(panel(page).locator('.summary')).toContainText('1 new document');
  expect(await page.locator('.pane-end input.pick-folder').evaluate((el: HTMLInputElement) => el.files?.length ?? 0)).toBe(0);
  expect(errors).toEqual([]);
});
