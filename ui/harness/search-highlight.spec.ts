import { test, expect, type Page } from '@playwright/test';
import { createDocument, createRootFolder, openDocument, selectFolder } from './helpers';

// "If you have searched and selected something, can you make the searched text
// be highlighted in the document?"
//
// The highlight is painted with the CSS Custom Highlight API — ranges over the
// already-sanitised text nodes — rather than by rewriting the rendered HTML.
// That keeps every byte of `{@html}` coming from renderMarkdown/DOMPurify, so
// these specs assert on the highlight registry rather than on <mark> elements
// that must never exist.

const HIGHLIGHT = 'ark-search';

/** The text each live highlight range covers, in the order they were added. */
async function highlighted(page: Page): Promise<string[]> {
  return page.evaluate((name) => {
    const registry = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
    const highlight = registry?.get(name);
    if (!highlight) return [];
    return [...highlight].map((range) => range.toString());
  }, HIGHLIGHT);
}

async function seed(page: Page) {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Finance');
  await selectFolder(page, 'Finance');
  await createDocument(page, {
    title: 'Finance minutes',
    body: 'The treasurer reported on the year.\n\nThe well pump was replaced last spring.',
    date: '2026-01-05',
  });
  await createDocument(page, {
    title: 'Roof committee minutes',
    body: 'The roof was inspected.',
    date: '2026-02-05',
  });
}

async function openFirstHit(page: Page, query: string) {
  const search = page.locator('input[type="search"]');
  await search.fill(query);
  const row = page.locator('.search-popup .panel li.result').first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('article .body')).toBeVisible();
}

test('opening a search hit highlights the matched text in the document body', async ({ page }) => {
  await seed(page);
  // Prefix query, the way the index itself matches: the whole word lights up.
  await openFirstHit(page, 'treasur');
  await expect.poll(() => highlighted(page)).toEqual(['treasurer']);

  // And never by rewriting the sanitised markup.
  await expect(page.locator('article .body mark')).toHaveCount(0);

  // A registered highlight is only visible if a ::highlight() rule styles it.
  // Assert the rule survived into a stylesheet rather than being dropped as
  // an unknown pseudo-element somewhere in the build.
  const styled = await page.evaluate((name) =>
    [...document.styleSheets].some((sheet) => {
      try {
        return [...sheet.cssRules].some((rule) => rule.cssText.includes(`::highlight(${name})`));
      } catch {
        return false;
      }
    }),
  HIGHLIGHT);
  expect(styled).toBe(true);
});

test('opening a document from the tree shows no highlights', async ({ page }) => {
  await seed(page);
  await openFirstHit(page, 'treasur');
  await expect.poll(() => highlighted(page)).toEqual(['treasurer']);

  // A stale highlight from a search three clicks ago is noise: reaching a
  // document any other way clears it.
  await page.locator('input[type="search"]').fill('');
  await openDocument(page, 'Roof committee minutes');
  await expect(page.locator('article .body')).toContainText('roof');
  await expect.poll(() => highlighted(page)).toEqual([]);

  // Including the very document the search opened. (Reached via the folder
  // row: sl-tree fires no selection-change for an item that is already
  // selected, so re-clicking the open document is a no-op throughout this
  // app, not something this feature introduced.)
  await selectFolder(page, 'Finance');
  await openDocument(page, 'Finance minutes');
  await expect(page.locator('article .body')).toContainText('treasurer');
  await expect.poll(() => highlighted(page)).toEqual([]);
});

test('a phrase query highlights the phrase, not each word separately', async ({ page }) => {
  await seed(page);
  await openFirstHit(page, '"well pump"');
  await expect.poll(() => highlighted(page)).toEqual(['well pump']);
});

test('a negated term is not highlighted', async ({ page }) => {
  await seed(page);
  // A naive whitespace split would light up "NOT" and "roof" as well.
  await openFirstHit(page, 'treasurer NOT roof');
  await expect.poll(() => highlighted(page)).toEqual(['treasurer']);
});

test('a browser without CSS.highlights still opens the document', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.addInitScript(() => {
    Object.defineProperty(CSS, 'highlights', { value: undefined, configurable: true });
  });
  await seed(page);
  await openFirstHit(page, 'treasur');

  await expect(page.locator('article .body')).toContainText('treasurer');
  expect(errors).toEqual([]);
});

test('a highlight never spans a block boundary', async ({ page }) => {
  // The unit tests build the DOM by hand; this one goes through the real
  // pipeline — marked, DOMPurify, Chromium — because that is what decides
  // where the blocks actually are.
  //
  // The body is raw HTML on purpose. Markdown bodies are mostly safe from
  // this by accident: marked pretty-prints a newline between block tags, and
  // that newline is itself a text node, so the concatenation gets a separator
  // whether or not this code supplies one. Raw HTML in a body — which
  // markdown permits and any member can write — has no such whitespace, and
  // "well" + "pumped" then reads as one word that exists in neither
  // paragraph.
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Finance');
  await selectFolder(page, 'Finance');
  await createDocument(page, {
    title: 'Boundary minutes',
    body: '<p>The pipeline ran well</p><p>pumped the water out.</p>',
    date: '2026-03-05',
  });

  await openFirstHit(page, 'well');
  await expect.poll(() => highlighted(page)).toEqual(['well']);
});
