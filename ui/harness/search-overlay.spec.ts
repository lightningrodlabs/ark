import { test, expect } from '@playwright/test';
import { createDocument, createRootFolder, selectFolder } from './helpers';

// Search results used to replace the document list in its own column, which
// meant searching threw away whatever you were looking at. They are now an
// overlay anchored to the input, floating over the tree, with focus never
// leaving the input.

const overlay = '.search-popup .panel';

async function seed(page: any) {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  await createDocument(page, {
    title: 'Fundraiser recap',
    body: 'The bake sale raised eight hundred dollars for the roof fund.',
    date: '2026-03-02',
  });
  await createDocument(page, {
    title: 'Roof committee',
    body: 'A second mention of the roof, so two documents match.',
    date: '2026-04-02',
  });
}

test('typing a query opens an overlay anchored under the input', async ({ page }) => {
  await seed(page);
  await expect(page.locator(overlay)).toHaveCount(0);

  const search = page.locator('input[type="search"]');
  await search.fill('roof');
  await expect(page.locator(overlay)).toBeVisible();

  // Anchored: the overlay sits directly below the search block and shares its
  // width, so the snippets get the whole bar to be readable in.
  const anchorBox = await page.locator('.search').boundingBox();
  const inputBox = await search.boundingBox();
  const panelBox = await page.locator(overlay).boundingBox();
  expect(panelBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height - 1);
  expect(Math.abs(panelBox!.width - anchorBox!.width)).toBeLessThan(2);

  // Floating over the tree rather than replacing it: the tree is still there.
  await expect(page.locator('sl-tree')).toBeVisible();
});

test('each result says what it is, where it is, and why it matched', async ({ page }) => {
  await seed(page);
  await page.locator('input[type="search"]').fill('bake');

  const row = page.locator(`${overlay} li.result`).first();
  await expect(row.locator('.title')).toHaveText('Fundraiser recap');
  await expect(row.locator('.path')).toHaveText('Board Minutes');
  // The KWIC snippet, with the matched term marked.
  await expect(row.locator('.snippet')).toContainText('bake sale raised eight hundred dollars');
  await expect(row.locator('.snippet mark')).toHaveText('bake');
});

test('the visible result count matches the rows shown', async ({ page }) => {
  await seed(page);
  await page.locator('input[type="search"]').fill('roof');

  await expect(page.locator('.panel-count')).toHaveText('2 results');
  await expect(page.locator(`${overlay} li.result`)).toHaveCount(2);
});

test('the whole row including the snippet is the click target', async ({ page }) => {
  await seed(page);
  await page.locator('input[type="search"]').fill('bake');

  await page.locator(`${overlay} li.result .snippet`).first().click();
  await expect(page.getByRole('heading', { name: 'Fundraiser recap' })).toBeVisible();
  await expect(page.locator(overlay)).toHaveCount(0);
});

test('arrow keys move the active result and Enter opens it, focus never leaving the input', async ({
  page,
}) => {
  await seed(page);
  const search = page.locator('input[type="search"]');
  await search.fill('roof');
  await expect(page.locator(`${overlay} li.result`)).toHaveCount(2);

  await search.press('ArrowDown');
  await expect(page.locator(`${overlay} li.result`).first()).toHaveClass(/active/);
  await expect(search).toBeFocused();

  await search.press('ArrowDown');
  await expect(page.locator(`${overlay} li.result`).nth(1)).toHaveClass(/active/);
  await expect(search).toBeFocused();

  await search.press('ArrowUp');
  await expect(page.locator(`${overlay} li.result`).first()).toHaveClass(/active/);
  await expect(search).toBeFocused();

  const activeTitle = await page.locator(`${overlay} li.result.active .title`).textContent();
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: activeTitle! })).toBeVisible();
  await expect(page.locator(overlay)).toHaveCount(0);
  await expect(search).toBeFocused();
});

test('the active result is announced through aria-activedescendant', async ({ page }) => {
  await seed(page);
  const search = page.locator('input[type="search"]');
  await expect(search).toHaveAttribute('role', 'combobox');
  await search.fill('roof');

  await expect(search).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#ark-search-results')).toHaveAttribute('role', 'listbox');

  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'ark-search-option-0');
  await expect(page.locator('#ark-search-option-0')).toHaveAttribute('aria-selected', 'true');
});

test('Escape closes the overlay and leaves the query in place', async ({ page }) => {
  await seed(page);
  const search = page.locator('input[type="search"]');
  await search.fill('roof');
  await expect(page.locator(overlay)).toBeVisible();

  await search.press('Escape');
  await expect(page.locator(overlay)).toHaveCount(0);
  await expect(search).toHaveValue('roof');
  await expect(search).toBeFocused();
});

test('clicking outside closes the overlay', async ({ page }) => {
  await seed(page);
  await page.locator('input[type="search"]').fill('roof');
  await expect(page.locator(overlay)).toBeVisible();

  await page.locator('nav').click({ position: { x: 5, y: 5 } });
  await expect(page.locator(overlay)).toHaveCount(0);
});

test('an empty query leaves the overlay closed', async ({ page }) => {
  await seed(page);
  const search = page.locator('input[type="search"]');
  await search.fill('roof');
  await expect(page.locator(overlay)).toBeVisible();

  // An empty query correctly returns no hits, so there is nothing to float.
  await search.fill('');
  await expect(page.locator(overlay)).toHaveCount(0);
  await expect(page.locator('.bar .count')).toHaveText('0 results');
});

test('an attachment hit names the attachment it was found in', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  await createDocument(page, { title: 'With a file', body: 'Body text.' });

  await page.setInputFiles('input[type="file"]', {
    name: 'ledger.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('item,amount\nwellpump,1200\n'),
  });
  await expect(page.locator('li', { hasText: 'ledger.csv' })).toBeVisible();

  await page.locator('input[type="search"]').fill('wellpump');
  const row = page.locator(`${overlay} li.result`).first();
  await expect(row.locator('.attachment')).toHaveText('in attachment ledger.csv');
});

// Anchoring to the input alone put the overlay straight over the filters row,
// so the author and date filters became unreachable as soon as a query
// matched anything. The overlay anchors to the whole search block instead.
test('the filters row stays usable while results are showing', async ({ page }) => {
  await seed(page);
  await page.locator('input[type="search"]').fill('roof');
  await expect(page.locator(overlay)).toBeVisible();

  await page.getByRole('button', { name: 'Filters' }).click();
  const authorFilter = page.locator('.author-filter');
  await expect(authorFilter).toBeVisible();

  // Clickable, not merely visible: the overlay must not be on top of it.
  await authorFilter.locator('.author-toggle').first().click();
  await expect(page.locator('.bar .count')).toHaveText('2 results');
});

// The overlay must actually OCCLUDE the tree, not merely sit in front of it in
// the markup. Two separate things had to be true and only one of them was:
// `.panel` carried `z-index: 10` while `position: static`, where z-index does
// nothing at all, so the panel painted in ordinary document order and tree
// rows showed through it.
//
// Asserting the panel exists, or even that it is visible, would not have
// caught this — the same way asserting an <img> exists did not catch a dead
// blob URL. These assertions are about what is painted where.
test('the overlay is opaque and occludes the tree behind it', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  // Enough documents that the expanded folder definitely has rows sitting
  // underneath where the overlay will drop.
  for (const title of ['Roof one', 'Roof two', 'Roof three', 'Roof four', 'Roof five']) {
    await createDocument(page, { title, body: `The roof fund entry for ${title}.` });
    await selectFolder(page, 'Board Minutes');
  }
  await expect(page.locator('sl-tree-item[data-kind="doc"]')).toHaveCount(5);

  await page.locator('input[type="search"]').fill('roof');
  await expect(page.locator(overlay)).toBeVisible();

  const probe = await page.evaluate(() => {
    const panel = document.querySelector('.search-popup .panel') as HTMLElement;
    const cs = getComputedStyle(panel);
    const rect = panel.getBoundingClientRect();

    // Probe where the panel and the TREE actually overlap. The panel spans the
    // full width of the header, so its horizontal centre lands over the
    // right-hand detail pane, where there is no tree to occlude and the test
    // would prove nothing.
    const tree = document.querySelector('sl-tree') as HTMLElement;
    const treeRect = tree.getBoundingClientRect();
    const x = treeRect.x + treeRect.width / 2;
    const y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y);

    // Is there in fact a tree item at that coordinate, i.e. is the test
    // proving anything? Check what is underneath once the panel is ignored.
    const stack = document.elementsFromPoint(x, y);
    const treeBehind = stack.some((el) => el.tagName.toLowerCase() === 'sl-tree-item');

    return {
      background: cs.backgroundColor,
      position: cs.position,
      zIndex: cs.zIndex,
      hitIsInsidePanel: !!hit && panel.contains(hit),
      hitTag: hit?.tagName.toLowerCase() ?? null,
      treeBehind,
    };
  });

  // Fully opaque: an rgb() with no alpha channel, or rgba(..., 1).
  expect(probe.background).toMatch(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(,\s*1)?\)$/);
  expect(probe.background).not.toBe('rgba(0, 0, 0, 0)');

  // z-index only applies to a positioned element, so this is what makes the
  // stacking real rather than declared.
  expect(probe.position).not.toBe('static');
  expect(probe.zIndex).not.toBe('auto');

  // The tree really is behind that point, and the panel really is what the
  // pointer lands on.
  expect(probe.treeBehind).toBe(true);
  expect(probe.hitIsInsidePanel).toBe(true);
});

// The app root must paint an opaque background. A transparent root let Moss's
// backdrop show through, and — less obviously — cost text its subpixel
// antialiasing, which is what the "fuzzy shadow outlining of all text" report
// actually was. There is no text-shadow anywhere in this app.
test('the app root paints an opaque background and no text shadow', async ({ page }) => {
  await page.goto('/harness/index.html');
  // An empty archive has no folders, so sl-tree itself has no height — wait
  // on the pane heading instead.
  await expect(page.locator('.head strong')).toBeVisible();

  const probe = await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement;
    const bodyCs = getComputedStyle(document.body);
    const mainCs = getComputedStyle(main);
    const sample = document.querySelector('.head strong') as HTMLElement;
    return {
      bodyBg: bodyCs.backgroundColor,
      mainBg: mainCs.backgroundColor,
      textShadow: getComputedStyle(sample).textShadow,
      filter: getComputedStyle(sample).filter,
    };
  });

  expect(probe.bodyBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(probe.mainBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(probe.textShadow).toBe('none');
  expect(probe.filter).toBe('none');
});
