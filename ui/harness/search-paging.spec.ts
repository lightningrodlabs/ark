import { test, expect } from '@playwright/test';
import { createDocument, createRootFolder, selectFolder } from './helpers';
import { COMMITTEES, TOTAL_DOCUMENTS } from './seed';

// The results panel used to render a hard first fifty and stop: everything
// past that was unreachable, because the panel scrolls only over the rows it
// rendered and the arrow keys wrapped within them. On the reference archive a
// common name matches 956 documents and the user could see fifty of them.
//
// `search.run()` already returns every hit in memory, so revealing more costs
// DOM and nothing else. The list now starts at fifty and grows — by scrolling
// to the bottom of the panel, by an explicit button at the end of the list, or
// by arrowing past the last row — and the count line says how many of the
// total are showing so a grown list is never mistaken for the whole answer.

const overlay = '.search-popup .panel';
const rows = `${overlay} li.result`;
const scroller = `${overlay} .panel-scroll`;
const SEEDED = `/harness/index.html?seed=archive`;

/** The seeded archive: 1406 documents whose bodies all mention the treasurer. */
async function bootArchive(page: any) {
  await page.goto(SEEDED);
  await expect(page.locator('sl-tree-item[data-kind="folder"]')).toHaveCount(COMMITTEES, {
    timeout: 30_000,
  });
}

/**
 * Reach the "show more" button the way a keyboard user does, and press it.
 * Deterministic where a mouse click is not: clicking it means scrolling to
 * it, and that scroll can extend the list on its own before the click lands.
 */
async function extendByKeyboard(page: any) {
  await page.locator('input[type="search"]').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /Show \d+ more/i })).toBeFocused();
  await page.keyboard.press('Enter');
}

/** A hand-built archive of two documents — fewer hits than one page. */
async function bootSmall(page: any) {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  await createDocument(page, { title: 'Roof one', body: 'The roof fund was discussed.' });
  await createDocument(page, { title: 'Roof two', body: 'A second mention of the roof.' });
}

test('scrolling the panel to the bottom reveals the next page of results', async ({ page }) => {
  test.setTimeout(120_000);
  await bootArchive(page);

  await page.locator('input[type="search"]').fill('treasurer');
  await expect(page.locator(rows)).toHaveCount(50);

  // The panel has its own scroll container — the window never scrolls here.
  await page.locator(scroller).evaluate((el: HTMLElement) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator(rows)).toHaveCount(100);

  // One gesture, one page. A fling delivers several scroll events before the
  // DOM catches up; they must not compound into a jump to the whole hit list.
  const burst = await page.locator(scroller).evaluate((el: HTMLElement) => {
    const before = el.scrollTop;
    for (let i = 0; i < 5; i++) el.dispatchEvent(new Event('scroll'));
    return before;
  });
  expect(burst).toBeGreaterThan(0);
  await expect(page.locator(rows)).toHaveCount(100);
});

test('the "Show 50 more" button reveals more and is reachable by keyboard alone', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await bootArchive(page);

  const search = page.locator('input[type="search"]');
  await search.fill('treasurer');
  await expect(page.locator(rows)).toHaveCount(50);

  // Scroll-triggered loading alone is unreachable by keyboard and invisible to
  // a screen reader. The button is what makes the feature accessible, so it is
  // a real focusable, labelled button at the end of the list.
  const more = page.getByRole('button', { name: /Show 50 more/i });
  await expect(more).toBeVisible();

  await search.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  // Reaching the button must not pre-empt it: Tab scrolls it into view, which
  // lands at the bottom of the container, and an extension fired off that
  // would carry the button out from under the focus ring before it was used.
  await expect(page.locator(rows)).toHaveCount(50);

  await page.keyboard.press('Enter');
  await expect(page.locator(rows)).toHaveCount(100);
  // Extending must not steal focus away from where the user put it.
  await expect(more).toBeFocused();
});

test('the button works by mouse too, and the count line never disagrees with it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await bootArchive(page);

  await page.locator('input[type="search"]').fill('treasurer');
  const total = Number((await page.locator('.bar .count').textContent())!.replace(/[^\d]/g, ''));
  await expect(page.locator(rows)).toHaveCount(50);

  // Clicking it means scrolling to it, which may extend the list on its own
  // before the click lands — either is correct. What must hold either way is
  // that the list grew and the count line says so exactly.
  await page.getByRole('button', { name: /Show \d+ more/i }).click();
  await expect
    .poll(async () => page.locator(rows).count())
    .toBeGreaterThan(50);
  const rendered = await page.locator(rows).count();
  await expect(page.locator('.panel-count')).toHaveText(`showing ${rendered} of ${total} results`);
});

test('the count line names how many of how many, and stays correct as the list grows', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await bootArchive(page);

  await page.locator('input[type="search"]').fill('treasurer');
  const total = Number(
    (await page.locator('.bar .count').textContent())!.replace(/[^\d]/g, ''),
  );
  expect(total).toBeGreaterThan(900);

  await expect(page.locator('.panel-count')).toHaveText(`showing 50 of ${total} results`);
  await extendByKeyboard(page);
  await expect(page.locator('.panel-count')).toHaveText(`showing 100 of ${total} results`);
  await expect(page.locator(rows)).toHaveCount(100);
});

test('changing the query resets the list to the first page', async ({ page }) => {
  test.setTimeout(120_000);
  await bootArchive(page);

  const search = page.locator('input[type="search"]');
  await search.fill('treasurer');
  await extendByKeyboard(page);
  await extendByKeyboard(page);
  await expect(page.locator(rows)).toHaveCount(150);

  // A new search inheriting the previous one's grown length would render
  // hundreds of rows for a query the user has not even looked at yet.
  await search.fill('budget');
  await expect(page.locator(rows)).toHaveCount(50);
  await expect(page.locator('.panel-count')).toContainText('showing 50 of');
});

test('ArrowDown past the last rendered row extends rather than wrapping', async ({ page }) => {
  test.setTimeout(120_000);
  await bootArchive(page);

  const search = page.locator('input[type="search"]');
  await search.fill('treasurer');
  await expect(page.locator(rows)).toHaveCount(50);

  for (let i = 0; i < 60; i++) await search.press('ArrowDown');

  // Wrapping at the old cap would leave the active row somewhere in the first
  // ten; extending carries it straight on past fifty.
  await expect(search).toHaveAttribute('aria-activedescendant', 'ark-search-option-59');
  await expect(page.locator('#ark-search-option-59')).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator(rows).count()).toBeGreaterThan(50);
  await expect(search).toBeFocused();
});

test('once every hit is shown, ArrowDown wraps to the top again', async ({ page }) => {
  await bootSmall(page);

  const search = page.locator('input[type="search"]');
  await search.fill('roof');
  await expect(page.locator(rows)).toHaveCount(2);

  await search.press('ArrowDown');
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'ark-search-option-1');
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'ark-search-option-0');
});

test('a search with fewer than a page of hits offers no button and no "showing" line', async ({
  page,
}) => {
  await bootSmall(page);

  await page.locator('input[type="search"]').fill('roof');
  await expect(page.locator(rows)).toHaveCount(2);
  await expect(page.locator('.panel-count')).toHaveText('2 results');
  await expect(page.getByRole('button', { name: /Show \d+ more/i })).toHaveCount(0);
});

// The render cost the design was weighed against: virtualization was rejected
// as too fiddly for variable-height rows, on the assumption that growing the
// list a page at a time keeps each step cheap. This measures that rather than
// assuming it, and prints the numbers so they can be quoted.
test('the whole hit list can be reached, and the cost of getting there is measured', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await bootArchive(page);

  const search = page.locator('input[type="search"]');
  const t0 = Date.now();
  await search.fill('treasurer');
  await expect(page.locator(rows)).toHaveCount(50);
  const firstPageMs = Date.now() - t0;

  const total = Number((await page.locator('.bar .count').textContent())!.replace(/[^\d]/g, ''));
  const more = page.getByRole('button', { name: /Show \d+ more/i });

  // Focus the button once and hold it: it keeps focus across every extension
  // (proving the "must not steal focus" half), and pressing Enter on an
  // already-focused button measures the render alone, with no scroll or hit
  // test mixed in.
  await search.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();

  let extensions = 0;
  let worstMs = 0;
  const tAll = Date.now();
  while ((await more.count()) > 0) {
    const shown = await page.locator(rows).count();
    const t = Date.now();
    await page.keyboard.press('Enter');
    await expect(page.locator(rows)).toHaveCount(Math.min(shown + 50, total));
    worstMs = Math.max(worstMs, Date.now() - t);
    extensions++;
  }
  const allMs = Date.now() - tAll;

  // Interaction cost once every row is in the DOM — the state the cap existed
  // to avoid. This is the number that decides whether virtualization is worth
  // revisiting.
  const tKey = Date.now();
  await search.press('ArrowDown');
  await expect(page.locator('#ark-search-option-0')).toHaveAttribute('aria-selected', 'true');
  const keyMs = Date.now() - tKey;

  const tType = Date.now();
  await search.fill('budget');
  await expect(page.locator(rows)).toHaveCount(50);
  const resetMs = Date.now() - tType;

  console.log(
    `[paging] ${TOTAL_DOCUMENTS} documents, query "treasurer" -> ${total} hits\n` +
      `[paging] first page of 50: ${firstPageMs}ms\n` +
      `[paging] full extension to ${total} rows: ${allMs}ms over ${extensions} extensions, ` +
      `worst single extension ${worstMs}ms\n` +
      `[paging] ArrowDown at full extension: ${keyMs}ms\n` +
      `[paging] retyping the query back down to 50 rows: ${resetMs}ms`,
  );

  // Every hit reachable, and no page skipped or double-counted on the way.
  expect(extensions).toBe(Math.ceil((total - 50) / 50));
});
