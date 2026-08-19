import { expect, type Locator, type Page } from '@playwright/test';

// The UI is one sl-tree: folders are expandable nodes and the documents filed
// in them are leaf items underneath. These helpers name the handful of moves
// every spec makes on it, so a markup change lands in one place.

/** The row content of a folder node — its name, not its expanded subtree. */
export function folderRow(page: Page, name: string): Locator {
  return page.locator(`sl-tree-item[data-kind="folder"][data-name="${name}"] > .row`);
}

export function folderNode(page: Page, name: string): Locator {
  return page.locator(`sl-tree-item[data-kind="folder"][data-name="${name}"]`);
}

/** A document leaf anywhere in the tree, by its title. */
export function documentNode(page: Page, title: string): Locator {
  return page
    .locator('sl-tree-item[data-kind="doc"]')
    .filter({ has: page.locator('.doc-title', { hasText: title }) });
}

/**
 * Click the "New folder" button in the tree header, type a name into the
 * inline row it reveals, and confirm with Enter. (Electron does not implement
 * window.prompt, so folder naming is always an inline input — see
 * bug-folder-prompt.spec.ts.)
 */
export async function createRootFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New folder' }).click();
  const input = page.locator('nav input.add-input');
  await input.fill(name);
  await input.press('Enter');
  await expect(folderNode(page, name)).toBeVisible();
}

/** Open a folder's action menu — the single button that replaced ✎ ↳ 🗑. */
export async function openFolderMenu(page: Page, name: string): Promise<void> {
  await folderRow(page, name).hover();
  await folderRow(page, name).getByRole('button', { name: `Actions for ${name}` }).click();
}

/** Choose an item from a folder's action menu by its visible label. */
export async function folderMenuAction(
  page: Page,
  folder: string,
  action: 'Rename' | 'New sub-folder' | 'Delete',
): Promise<void> {
  await openFolderMenu(page, folder);
  await folderNode(page, folder).locator('sl-menu-item', { hasText: action }).first().click();
}

/** Add a sub-folder under an existing folder, via its action menu. */
export async function createSubFolder(
  page: Page,
  parentName: string,
  name: string,
): Promise<void> {
  await folderMenuAction(page, parentName, 'New sub-folder');
  const input = folderNode(page, parentName).locator('input.add-input');
  await input.fill(name);
  await input.press('Enter');
  await expect(folderNode(page, name)).toBeVisible();
}

/**
 * Select a folder, which also expands it to reveal the documents filed there
 * — the association the tree exists to make.
 */
export async function selectFolder(page: Page, name: string): Promise<void> {
  await folderRow(page, name).locator('.name').click();
  await expect(folderNode(page, name)).toHaveAttribute('expanded', '');
}

/** Click a document leaf in the tree to open it in the detail pane. */
export async function openDocument(page: Page, title: string): Promise<void> {
  await documentNode(page, title).locator('.doc-title').click();
}

/**
 * Open the "New document" editor, fill it in, and save. Leaves the created
 * document open in the detail pane (DocumentEditor's onDone selects it).
 */
export async function createDocument(
  page: Page,
  opts: { title: string; body: string; date?: string },
): Promise<void> {
  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByPlaceholder('Title').fill(opts.title);
  if (opts.date) await page.locator('input[type="date"]').fill(opts.date);
  await page.locator('textarea').fill(opts.body);
  await page.getByRole('button', { name: 'Add document' }).click();
}
