import { test, expect } from '@playwright/test';
import { createDocument } from './helpers';

// The stub client (stub-client.ts) never sets window.__ARK_TEST_CLIENT__'s
// weaveClient — App.svelte's weaveContext getter therefore has no
// profilesClient, which is exactly the "outside Moss" path from the Task A
// dispatch (hc-spin dev, this harness). Every author must render as an
// identicon there, and a raw base64 agent-key hash must never appear as text
// anywhere an author is shown.

// A base64-ish run of 8+ url-safe characters is what the old
// `encodeHashToBase64(...).slice(0, 8)` rendering looked like. Matched only
// where it contains a letter, so an ordinary "1/21/1970" date (digits and
// slashes, no letters) can't false-positive.
const HASH_LIKE = /(?=[A-Za-z0-9+/]*[A-Za-z])[A-Za-z0-9+/]{8,}/;

test('a version author renders as an identicon, not a hash', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createDocument(page, { title: 'Minutes', body: 'Original wording of the minutes.' });

  await page.getByRole('button', { name: 'Amend' }).click();
  await page.locator('textarea').fill('Corrected wording of the minutes.');
  await page.getByRole('button', { name: 'Save amendment' }).click();

  const history = page.locator('.history');
  await expect(history.locator('li')).toHaveCount(2);

  // An identicon is a <canvas>, not an <img> (that's the Moss-avatar path,
  // unreachable here since there is no profiles client).
  await expect(history.locator('canvas.agent-avatar')).toHaveCount(2);
  await expect(history.locator('img.agent-avatar')).toHaveCount(0);

  // Scoped to the version rows (the <ol>), not the whole `.history` section
  // — its own "Versions" heading is eight letters and would otherwise
  // false-positive.
  const text = await history.locator('ol').innerText();
  expect(text).not.toMatch(HASH_LIKE);
});

test('the search author filter shows an identicon toggle, not a hash', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createDocument(page, {
    title: 'Fundraiser recap',
    body: 'The bake sale raised eight hundred dollars for the roof fund.',
  });

  // A query is required to get any hits at all now (Task B: an empty query
  // always returns zero, filters or not) — this also proves the author
  // toggle filters a real search rather than standing in for the old browse.
  await page.locator('input[type="search"]').fill('bake');
  await expect(page.locator('.bar .count')).toHaveText('1 result');

  await page.getByRole('button', { name: 'Filters' }).click();
  const authorFilter = page.locator('.author-filter');
  await expect(authorFilter).toBeVisible();

  await expect(authorFilter.locator('canvas.agent-avatar')).toHaveCount(1);
  await expect(authorFilter.locator('img.agent-avatar')).toHaveCount(0);

  const text = await authorFilter.innerText();
  expect(text).not.toMatch(HASH_LIKE);

  // Selecting the author toggle actually filters — proof it carries a real
  // agent key, not decoration.
  await authorFilter.locator('.author-toggle').click();
  await expect(page.locator('.bar .count')).toHaveText('1 result');
});
