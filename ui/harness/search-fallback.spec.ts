import { test, expect, type Page } from '@playwright/test';
import { createDocument, createRootFolder, selectFolder } from './helpers';

/**
 * Near matches as a labelled fallback, and the Filters control as a real
 * toggle.
 *
 * The reported symptom was that highlighting stopped partway down a result
 * list. The cause was that every search ran fuzzy, so a hit did not have to
 * contain the query — and a hit the app cannot mark is a hit it cannot
 * justify. These specs are about what the user can actually see: the note
 * naming what was matched instead, a mark on every row, and the same term
 * marked again in the document the row opens.
 *
 * All fixture text is invented. `Asif` is one substitution from the typo
 * `asdf`; `bean` and `Sean` are each one edit from `Jean`. That is the shape
 * the reference corpus has, and the only thing borrowed from it.
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
    body: 'Asif walked the fence line and reported no damage.',
    date: '2026-01-05',
  });
  await createDocument(page, {
    title: 'February minutes',
    body: 'Jean opened the meeting and read the minutes.',
    date: '2026-02-05',
  });
  await createDocument(page, {
    title: 'March minutes',
    body: 'The bean beds were turned over before the frost.',
    date: '2026-03-05',
  });
  await createDocument(page, {
    title: 'Sean on the culvert',
    body: 'The culvert survey was tabled until the next meeting.',
    date: '2026-04-05',
  });
}

const note = (page: Page) => page.locator('[data-testid="near-match"]');
const rows = (page: Page) => page.locator(`${overlay} li.result`);

test('a query nothing matches exactly falls back to near matches and names them', async ({
  page,
}) => {
  await seed(page);
  await page.locator('input[type="search"]').fill('asdf');

  // The archive contains no "asdf". It does contain "Asif", one substitution
  // away — which is why the old search returned this row with no explanation
  // and nothing marked on it.
  await expect(note(page)).toBeVisible();
  await expect(note(page)).toContainText('No results for “asdf”');
  await expect(note(page)).toContainText('“asif”');

  await expect(rows(page)).toHaveCount(1);
  // The row marks what actually matched, not the query it could never find.
  await expect(rows(page).first().locator('mark')).toHaveText(['Asif']);
  // Even in the fallback mode the near rows say what they are, so a result
  // list is never a mix the user has to work out for themselves.
  await expect(rows(page).first().locator('.near-badge')).toHaveText('Near match');
});

test('opening a near-match hit highlights the matched term in the document', async ({ page }) => {
  await seed(page);
  await page.locator('input[type="search"]').fill('asdf');
  await rows(page).first().click();
  await expect(page.locator('article .body')).toBeVisible();

  // The second highlight path, and the easy one to miss: the document used to
  // derive its terms by re-parsing the query, so a document opened from a
  // near-match hit marked nothing at all — the same blank result in a new
  // place.
  await expect.poll(() => highlighted(page)).toEqual(['Asif']);
});

test('a query with exact hits never falls back, even though near matches exist', async ({
  page,
}) => {
  await seed(page);
  await page.locator('input[type="search"]').fill('jean');

  // "bean" and "Sean" are both one edit away and both used to be returned,
  // unmarked, below the real answers.
  await expect(note(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('February minutes');
  await expect(rows(page).first().locator('mark')).toHaveText(['Jean']);
});

test('with near matches turned off the query returns nothing and says so plainly', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByLabel('Near matches').selectOption('never');

  await page.locator('input[type="search"]').fill('asdf');
  await expect(page.locator('.bar .count')).toHaveText('0 results');
  await expect(note(page)).toHaveCount(0);
  await expect(page.locator(overlay)).toHaveCount(0);

  // And the switch does not touch a query that matches exactly.
  await page.locator('input[type="search"]').fill('jean');
  await expect(rows(page)).toHaveCount(1);
});

test('the Filters control is a toggle that reports and closes its own panel', async ({ page }) => {
  await seed(page);
  const toggle = page.getByRole('button', { name: 'Filters' });

  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-controls', 'ark-search-filters');
  await expect(page.locator('#ark-search-filters')).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#ark-search-filters')).toBeVisible();

  // "You can't tell how to close the filters section": clicking it again does.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#ark-search-filters')).toHaveCount(0);
});

test('Escape inside the filters panel closes it and returns focus to the toggle', async ({
  page,
}) => {
  await seed(page);
  const toggle = page.getByRole('button', { name: 'Filters' });
  await toggle.click();

  await page.locator('#ark-search-filters label', { hasText: 'From' }).locator('input').focus();
  await page.keyboard.press('Escape');

  await expect(page.locator('#ark-search-filters')).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test('the funnel fills in whenever a filter is actually narrowing the search', async ({ page }) => {
  await seed(page);
  const toggle = page.getByRole('button', { name: 'Filters' });
  const icon = toggle.locator('sl-icon');

  await expect(icon).toHaveAttribute('name', 'funnel');
  await expect(toggle.locator('.filter-dot')).toHaveCount(0);

  await toggle.click();
  await page.locator('#ark-search-filters label', { hasText: 'From' }).locator('input').fill('2026-02-01');

  // Visible from the collapsed bar, not only from inside the panel — an
  // invisible filter has already emptied this app's results once.
  await toggle.click();
  await expect(page.locator('#ark-search-filters')).toHaveCount(0);
  await expect(icon).toHaveAttribute('name', 'funnel-fill');
  await expect(toggle.locator('.filter-dot')).toBeVisible();

  // A near-match mode other than the default counts too — in BOTH directions.
  // `never` narrows in the ordinary way; `always` widens, and still has to
  // show, because a session left in it three days ago is otherwise a mystery.
  await toggle.click();
  await page.locator('#ark-search-filters label', { hasText: 'From' }).locator('input').fill('');
  await expect(icon).toHaveAttribute('name', 'funnel');
  await page.getByLabel('Near matches').selectOption('never');
  await expect(icon).toHaveAttribute('name', 'funnel-fill');
  await page.getByLabel('Near matches').selectOption('always');
  await expect(icon).toHaveAttribute('name', 'funnel-fill');
  await page.getByLabel('Near matches').selectOption('fallback');
  await expect(icon).toHaveAttribute('name', 'funnel');
});
