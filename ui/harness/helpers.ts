import type { Page } from '@playwright/test';

/**
 * Click the "+" that adds a root-level folder, type a name into the inline
 * row it reveals (FolderTree.svelte), and confirm with Enter.
 */
export async function createRootFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '+', exact: true }).click();
  const input = page.locator('nav input.add-input');
  await input.fill(name);
  await input.press('Enter');
}

/**
 * Click a folder's own "+" (FolderNode.svelte) to add a sub-folder under it.
 */
export async function createSubFolder(page: Page, parentName: string, name: string): Promise<void> {
  const parentRow = page.locator('li', { hasText: parentName }).first();
  await parentRow.getByTitle('New sub-folder').click();
  const input = page.locator('nav input.add-input');
  await input.fill(name);
  await input.press('Enter');
}

/** Select a folder (or "All documents") in the sidebar. */
export async function selectFolder(page: Page, name: string): Promise<void> {
  await page
    .locator('nav')
    .getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
    .click();
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
