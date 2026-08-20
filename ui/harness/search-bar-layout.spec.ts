import { test, expect } from '@playwright/test';
import { createRootFolder, selectFolder } from './helpers';

// The search bar is a flex row — input, scope chip or offer, Filters, count.
// A long folder name made "Scope to <name>" or "in <name> ✕" wide and the
// input absorbed the loss until it was unusable on a small screen.
//
// Both controls stay in the bar: an active scope has to remain visible,
// because a filter that narrows results with no visible sign is the exact bug
// the chip was built to prevent. So the chip truncates (visually only — the
// text content, and therefore the accessible name, keeps the whole path, and
// `title` puts it on hover), the input gets a floor it cannot be pushed
// below, and the bar wraps to a second line rather than compressing anything.

const LONG = 'Regional Facilities and Grounds Maintenance Standing Committee';
const SHORT = 'Legal';
/** The floor `.bar input[type=search]` declares, in px at a 16px root. */
const MIN_INPUT_PX = 160;

async function seed(page: any, folder: string) {
  await page.goto('/harness/index.html');
  await createRootFolder(page, folder);
  await selectFolder(page, folder);
}

test('a long folder name does not squeeze the input at a narrow width', async ({ page }) => {
  await seed(page, LONG);
  await page.setViewportSize({ width: 480, height: 900 });

  const input = page.locator('input[type="search"]');
  const offer = page.getByRole('button', { name: new RegExp(`Scope to ${LONG}`, 'i') });
  await expect(offer).toBeVisible();

  const bar = page.locator('.search .bar');
  for (const control of [offer, page.locator('.scope-chip')]) {
    if ((await control.count()) === 0) continue;
    const box = (await control.boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(barBox.x + barBox.width + 1);
  }

  expect((await input.boundingBox())!.width).toBeGreaterThanOrEqual(MIN_INPUT_PX);

  // And the same once the scope is actually on, which is the wider of the two.
  await offer.click();
  const chip = page.locator('.scope-chip');
  await expect(chip).toBeVisible();
  const chipBox = (await chip.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(barBox.x + barBox.width + 1);
  expect((await input.boundingBox())!.width).toBeGreaterThanOrEqual(MIN_INPUT_PX);
});

test('truncation is visual only — the full path stays in the title and the accessible name', async ({
  page,
}) => {
  await seed(page, LONG);
  await page.setViewportSize({ width: 480, height: 900 });

  const offer = page.locator('.scope-offer');
  await expect(offer).toHaveAttribute('title', new RegExp(LONG));
  await offer.click();

  const chip = page.locator('.scope-chip');
  await expect(chip).toHaveAttribute('title', new RegExp(LONG));
  // The text content — what a screen reader reads — is the whole path even
  // though the pixels are ellipsised.
  await expect(chip).toContainText(LONG);
  await expect(page.getByRole('button', { name: new RegExp(LONG) })).toBeVisible();

  const clipped = await chip.locator('.scope-label').evaluate((el: HTMLElement) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    ellipsis: getComputedStyle(el).textOverflow,
  }));
  expect(clipped.ellipsis).toBe('ellipsis');
  expect(clipped.scroll).toBeGreaterThan(clipped.client);
});

test('the dismiss ✕ stays clickable at every width', async ({ page }) => {
  await seed(page, LONG);
  for (const width of [1280, 640, 480, 380]) {
    await page.setViewportSize({ width, height: 900 });
    const offer = page.locator('.scope-offer');
    await expect(offer).toBeVisible();
    await offer.click();
    const dismiss = page.locator('.scope-dismiss');
    await expect(dismiss).toBeVisible();
    await dismiss.click();
    await expect(page.locator('.scope-chip')).toHaveCount(0);
  }
});

test('a short folder name renders unchanged, with no stray ellipsis', async ({ page }) => {
  await seed(page, SHORT);
  await page.locator('.scope-offer').click();

  const label = page.locator('.scope-chip .scope-label');
  await expect(label).toHaveText(`in ${SHORT}`);
  const clipped = await label.evaluate((el: HTMLElement) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  expect(clipped.scroll).toBeLessThanOrEqual(clipped.client);
});
