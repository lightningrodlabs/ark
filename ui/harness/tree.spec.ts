import { test, expect } from '@playwright/test';
import {
  createDocument,
  createRootFolder,
  createSubFolder,
  documentNode,
  folderMenuAction,
  folderNode,
  folderRow,
  openDocument,
  selectFolder,
} from './helpers';

// The folder pane and the separate document list are now one sl-tree: folders
// are expandable nodes, the documents filed in them are the leaves. These
// specs cover the association that restructure exists to create.

test('expanding a folder reveals the documents filed in it', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  await createDocument(page, {
    title: 'January meeting',
    body: 'We approved the annual budget of $12,000.',
    date: '2026-01-15',
  });

  // Documents are lazy: they reach the DOM only once their folder is opened.
  // Collapse first so the reveal is actually being tested.
  await folderNode(page, 'Board Minutes').evaluate((el: any) => (el.expanded = false));
  await expect(documentNode(page, 'January meeting')).toBeHidden();

  await selectFolder(page, 'Board Minutes');
  await expect(documentNode(page, 'January meeting')).toBeVisible();
});

test('clicking a document in the tree opens it in the detail pane', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  await createDocument(page, {
    title: 'January meeting',
    body: 'We approved the annual budget of $12,000.',
    date: '2026-01-15',
  });

  await selectFolder(page, 'Board Minutes');
  await openDocument(page, 'January meeting');

  await expect(page.getByRole('heading', { name: 'January meeting' })).toBeVisible();
  await expect(page.locator('.body')).toContainText('We approved the annual budget of $12,000.');
});

test('a sub-folder nests under its parent and holds its own documents', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await createSubFolder(page, 'Board Minutes', '2026');

  // Nesting is structural, not just visual: the child node lives inside the
  // parent node's element.
  await expect(folderNode(page, 'Board Minutes').locator('sl-tree-item[data-name="2026"]')).toHaveCount(1);

  await selectFolder(page, '2026');
  await createDocument(page, { title: 'Q1 notes', body: 'First quarter.' });
  await selectFolder(page, '2026');
  await expect(
    folderNode(page, '2026').locator('sl-tree-item[data-kind="doc"]'),
  ).toHaveCount(1);
});

// Three glyphs per row (✎ ↳ 🗑) became one button opening a menu, revealed on
// hover or keyboard focus.
test('the folder action menu renames a folder', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Old Name');

  await folderMenuAction(page, 'Old Name', 'Rename');
  const input = folderNode(page, 'Old Name').locator('input.rename-input');
  await expect(input).toBeFocused();
  await input.fill('New Name');
  await input.press('Enter');

  await expect(folderNode(page, 'New Name')).toBeVisible();
  await expect(folderNode(page, 'Old Name')).toHaveCount(0);
});

test('Escape cancels a folder rename without changing the name', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Keep Me');

  await folderMenuAction(page, 'Keep Me', 'Rename');
  const input = folderNode(page, 'Keep Me').locator('input.rename-input');
  await input.fill('Discarded');
  await input.press('Escape');

  await expect(folderNode(page, 'Keep Me')).toBeVisible();
  await expect(folderNode(page, 'Discarded')).toHaveCount(0);
});

test('the folder action menu deletes a folder and relocates its documents', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Old Committee');
  await selectFolder(page, 'Old Committee');
  await createDocument(page, { title: 'Committee notes', body: 'Notes from the old committee.' });

  // Deleting a root folder relocates its documents to Unfiled (no parent to
  // fall back to) — see planFolderDeletion in tree/deletion.ts. confirm() IS
  // implemented by Electron, unlike prompt().
  page.once('dialog', (dialog) => dialog.accept());
  await folderMenuAction(page, 'Old Committee', 'Delete');

  await expect(folderNode(page, 'Old Committee')).toHaveCount(0);
  const unfiledSection = page.locator('section', { hasText: 'Unfiled' });
  await expect(unfiledSection.getByRole('button', { name: /Committee notes/ })).toBeVisible();
});

// The reported complaint was that the columns resized on their own, worst of
// all when a document was opened. sl-split-panel gives the divider a position
// that only a drag changes.
test('the split divider does not move when a document is opened', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  await createDocument(page, {
    title: 'A document with a very long title that would once have widened its column',
    body: 'A long body. '.repeat(200),
  });
  await selectFolder(page, 'Board Minutes');

  const panel = page.locator('sl-split-panel');
  const before = await panel.evaluate((el: any) => el.position);
  const treeBefore = await page.locator('nav').boundingBox();

  await openDocument(page, 'A document with a very long title');
  await expect(page.locator('.body')).toContainText('A long body.');

  expect(await panel.evaluate((el: any) => el.position)).toBe(before);
  const treeAfter = await page.locator('nav').boundingBox();
  expect(treeAfter?.width).toBe(treeBefore?.width);
});

test('the tree keeps the folder selected while its document is open', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await selectFolder(page, 'Board Minutes');
  await createDocument(page, { title: 'January meeting', body: 'Body.' });
  await selectFolder(page, 'Board Minutes');
  await openDocument(page, 'January meeting');

  // Exactly one node is marked selected at a time, so the highlight is never
  // ambiguous: opening a document moves it from the folder to the document.
  await expect(documentNode(page, 'January meeting')).toHaveAttribute('selected', '');
  await expect(page.locator('sl-tree-item[selected]')).toHaveCount(1);
});

test('the folder action button is hidden until the row is hovered', async ({ page }) => {
  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');

  const actions = folderNode(page, 'Board Minutes').locator('sl-dropdown.actions');
  await expect(actions).toBeHidden();
  await folderRow(page, 'Board Minutes').hover();
  await expect(actions).toBeVisible();
});

// Shoelace normally FETCHES icon SVGs from `{basePath}/assets/icons/*.svg`.
// A Moss applet runs from a sandboxed iframe with no network, and the full
// icon set is 8.5 MB of 2052 files that has no business in an applet zip, so
// src/shoelace.ts registers a resolver returning inline data URIs instead.
// This spec fails if that ever silently stops producing an icon — an
// unresolved name renders as nothing at all rather than throwing.
test('folder action icons render from the inline icon library, with no network fetch', async ({
  page,
}) => {
  const requested: string[] = [];
  await page.route('**/*.svg', (route) => {
    requested.push(route.request().url());
    return route.continue();
  });

  await page.goto('/harness/index.html');
  await createRootFolder(page, 'Board Minutes');
  await folderRow(page, 'Board Minutes').hover();

  // Located through the row rather than by `[name=...]`: Svelte assigns
  // custom-element props as PROPERTIES once the element is registered, and
  // Shoelace does not reflect `name` back to an attribute, so there is no
  // `name` attribute in the DOM to match on.
  const drew = await folderRow(page, 'Board Minutes')
    .locator('sl-icon-button')
    .first()
    .evaluate((el: any) => ({
      name: el.name,
      hasSvg: !!el.shadowRoot?.querySelector('sl-icon')?.shadowRoot?.querySelector('svg'),
    }));
  expect(drew.name).toBe('three-dots-vertical');
  expect(drew.hasSvg).toBe(true);

  // The tree's own expand chevrons come from Shoelace's built-in `system`
  // library, which is inline already; neither path may go to the network.
  expect(requested).toEqual([]);
});
