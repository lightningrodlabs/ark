import { test, expect, type Page } from '@playwright/test';
import { createDocument, createRootFolder, selectFolder } from './helpers';

/**
 * Near matches as a three-way choice, and the one case only `always` reaches:
 * the archive contains its own misspelling.
 *
 * Someone typed `Jeen` into a document. No exact or prefix search will ever
 * find it, and the fallback will not either, because `Jean` always has real
 * answers. `always` mixes near matches in with those answers — which also
 * drags in `bean`, so the whole spec is about whether the user can tell the
 * two apart at a glance.
 *
 * All fixture text is invented. `Jeen` is "a name misspelled by one letter in
 * the archive itself"; `bean` is "an ordinary word one edit from a name".
 * That is the shape the reference corpus has, and the only thing borrowed.
 */

const HIGHLIGHT = 'ark-search';
const overlay = '.search-popup .panel';

/** The text each live highlight range covers — see search-highlight.spec.ts. */
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
  await createRootFolder(page, 'Buildings and Land');
  await selectFolder(page, 'Buildings and Land');
  await createDocument(page, {
    title: 'January minutes',
    body: 'Jean opened the meeting and read the minutes.',
    date: '2026-01-05',
  });
  await createDocument(page, {
    title: 'March minutes',
    body: 'The bean beds were turned over before the frost.',
    date: '2026-03-05',
  });
  // The archive's own typo, and the entire reason `always` exists.
  await createDocument(page, {
    title: 'May minutes',
    body: 'Jeen confirmed the gutter repairs were finished.',
    date: '2026-05-05',
  });
  await createDocument(page, {
    title: 'June minutes',
    body: 'Jean tabled the fence line report.',
    date: '2026-06-05',
  });
}

const mode = (page: Page) => page.getByLabel('Near matches');
const note = (page: Page) => page.locator('[data-testid="near-match"]');
const rows = (page: Page) => page.locator(`${overlay} li.result`);
const nearRows = (page: Page) => page.locator(`${overlay} li.result.near`);

async function chooseMode(page: Page, value: string) {
  const toggle = page.getByRole('button', { name: 'Filters' });
  await toggle.click();
  await mode(page).selectOption(value);
  await toggle.click();
  await expect(page.locator('#ark-search-filters')).toHaveCount(0);
}

test('the control offers all three modes and starts on the default', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Filters' }).click();

  await expect(mode(page)).toHaveValue('fallback');
  await expect(mode(page).locator('option')).toHaveText([
    'Only when nothing matches',
    'Always',
    'Never',
  ]);
});

test('always: a misspelling that lives in the archive becomes findable', async ({ page }) => {
  await seed(page);
  await chooseMode(page, 'always');
  await page.locator('input[type="search"]').fill('jean');

  // Nobody will ever type "Jeen" on purpose. Under the default mode this
  // document is invisible forever, because "Jean" always finds something.
  const typo = rows(page).filter({ hasText: 'May minutes' });
  await expect(typo).toHaveCount(1);
  await expect(typo).toHaveClass(/near/);
  await expect(typo.locator('.near-badge')).toHaveText('Near match');
  // It marks the word it actually matched — the same highlight path the
  // fallback uses, not a second copy of it.
  await expect(typo.locator('mark')).toHaveText(['Jeen']);

  // And the document it opens marks the same word.
  await typo.click();
  await expect(page.locator('article .body')).toBeVisible();
  await expect.poll(() => highlighted(page)).toEqual(['Jeen']);
});

test('always: exact hits come first, near ones after and clearly marked', async ({ page }) => {
  await seed(page);
  await chooseMode(page, 'always');
  await page.locator('input[type="search"]').fill('jean');

  // Two documents say Jean; two are merely near — the typo, and the beans.
  const titles = await rows(page).locator('.title').allTextContents();
  expect(titles.slice(0, 2).sort()).toEqual(['January minutes', 'June minutes']);
  expect(titles.slice(2).sort()).toEqual(['March minutes', 'May minutes']);

  // Every near row is behind every exact one, and every one of them says so.
  await expect(nearRows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).not.toHaveClass(/near/);
  await expect(rows(page).nth(1)).not.toHaveClass(/near/);
  await expect(nearRows(page).nth(0)).toContainText('Near match');
  await expect(nearRows(page).nth(1)).toContainText('Near match');
  // Plus the divider, exactly once, at the boundary.
  await expect(page.locator(`${overlay} li.near-divider`)).toHaveCount(1);

  // No document appears twice — the fuzzy pass returns the exact ones too.
  expect(new Set(titles).size).toEqual(titles.length);

  // Two numbers, never one. "4 results" here is the shape of the original bug.
  await expect(page.locator('.bar .count')).toHaveText('2 results, 2 near matches');
  await expect(note(page)).toContainText('Also showing 2 near matches');
  await expect(note(page)).toContainText('listed after the 2 exact results');
});

test('always: every row the user can see is one the app can mark', async ({ page }) => {
  await seed(page);
  await chooseMode(page, 'always');
  await page.locator('input[type="search"]').fill('jean');

  const count = await rows(page).count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(rows(page).nth(i).locator('mark').first()).toBeVisible();
  }
});

test('always: a query with nothing near it still returns only its exact hits', async ({ page }) => {
  await seed(page);
  await chooseMode(page, 'always');
  await page.locator('input[type="search"]').fill('gutter');

  await expect(rows(page)).toHaveCount(1);
  await expect(nearRows(page)).toHaveCount(0);
  await expect(note(page)).toHaveCount(0);
  await expect(page.locator('.bar .count')).toHaveText('1 result');
});

test('fallback: the default is unchanged — no near matches while exact hits exist', async ({
  page,
}) => {
  await seed(page);
  await page.locator('input[type="search"]').fill('jean');

  await expect(rows(page)).toHaveCount(2);
  await expect(nearRows(page)).toHaveCount(0);
  await expect(note(page)).toHaveCount(0);
  await expect(page.locator('.bar .count')).toHaveText('2 results');
});

test('never: zero means zero, with no fallback offered', async ({ page }) => {
  await seed(page);
  await chooseMode(page, 'never');
  await page.locator('input[type="search"]').fill('jeon');

  await expect(page.locator('.bar .count')).toHaveText('0 results');
  await expect(page.locator(overlay)).toHaveCount(0);
  await expect(note(page)).toHaveCount(0);

  // The same query under the default mode does find the near ones, so the
  // zero above is the mode's doing and not an empty archive.
  await chooseMode(page, 'fallback');
  await expect(rows(page).first()).toBeVisible();
  await expect(note(page)).toContainText('No results for “jeon”');
});
