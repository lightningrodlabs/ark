import { test, expect } from '@playwright/test';
import { BIGGEST_COMMITTEE, COMMITTEES, TOTAL_DOCUMENTS } from './seed';

// The sl-tree spike, kept as a standing guard rather than thrown away.
//
// The dispatch asked for confirmation that sl-tree copes before the redesign
// was committed to: the reference archive is 1406 documents across thirteen
// committees, and one committee holds 280. It does cope — comfortably — and
// these specs keep it that way, in particular by failing if documents ever
// stop being lazily loaded.
//
// Timings are printed as well as asserted so the numbers can be quoted; the
// budgets are deliberately loose, since a shared CI box is slower than this.

const SEEDED = '/harness/index.html?seed=archive';

async function boot(page: any) {
  const t0 = Date.now();
  await page.goto(SEEDED);
  await expect(page.locator('sl-tree-item[data-kind="folder"]')).toHaveCount(COMMITTEES, {
    timeout: 30_000,
  });
  return Date.now() - t0;
}

test('the tree mounts the whole archive with only folder nodes in the DOM', async ({ page }) => {
  test.setTimeout(120_000);
  const mountMs = await boot(page);

  const docItems = await page.locator('sl-tree-item[data-kind="doc"]').count();
  console.log(
    `[scale] boot with ${TOTAL_DOCUMENTS} documents: ${mountMs}ms, ` +
      `${COMMITTEES} folder nodes, ${docItems} document nodes in the DOM`,
  );

  // The whole point of lazy loading: 1406 documents are in memory and
  // searchable, and NONE of them is a custom element yet.
  expect(docItems).toBe(0);
});

test('expanding the largest committee loads its documents and stays responsive', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await boot(page);

  const big = page.locator('sl-tree-item[data-kind="folder"]').first();
  const t0 = Date.now();
  await big.locator('.name').click();
  await expect(page.locator('sl-tree-item[data-kind="doc"]')).toHaveCount(BIGGEST_COMMITTEE, {
    timeout: 30_000,
  });
  const expandMs = Date.now() - t0;
  console.log(`[scale] expand the ${BIGGEST_COMMITTEE}-document committee: ${expandMs}ms`);

  // Still interactive with the biggest node open: open a document from deep
  // in the list.
  const deep = page.locator('sl-tree-item[data-kind="doc"]').nth(200);
  const t1 = Date.now();
  await deep.locator('.doc-title').click();
  await expect(page.locator('.body')).toBeVisible({ timeout: 15_000 });
  console.log(`[scale] open a document 200 rows deep: ${Date.now() - t1}ms`);
});

test('search over the whole archive answers into the overlay', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);

  const t0 = Date.now();
  await page.locator('input[type="search"]').fill('treasurer');
  await expect(page.locator('.search-popup .panel')).toBeVisible({ timeout: 30_000 });
  const rows = await page.locator('.search-popup .panel li.result').count();
  console.log(`[scale] query "treasurer" over ${TOTAL_DOCUMENTS} documents: ${Date.now() - t0}ms, ${rows} rows rendered`);

  // A query this broad matches nearly the whole archive. The count stays
  // honest about that, but only the first page of rows reaches the DOM —
  // rendering one row per hit cost ~400ms to build a list nobody scrolls to
  // the end of.
  await expect(page.locator('.panel-count')).toContainText('showing the first 50');
  expect(rows).toBe(50);
  const panelHeight = (await page.locator('.search-popup .panel').boundingBox())!.height;
  expect(panelHeight).toBeLessThan(600);
});
