import type { Folder } from '../types';
import { folderPath } from '../tree/paths';

export interface FolderOption {
  id: string;
  label: string;
}

/**
 * Options for the create-mode folder picker, depth-first so children follow
 * their parent, indented by two spaces per level (via folderPath's ancestor
 * chain) so the tree shape is visible in a plain `<select>`. Callers pass
 * `tree.live` — tombstoned folders are never offered, and since deleting a
 * folder tombstones its whole subtree (see tree/deletion.ts), every live
 * folder's ancestors are live too, so `folderPath` never needs the raw list.
 */
export function folderOptions(folders: Folder[]): FolderOption[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parent) ?? [];
    siblings.push(folder);
    byParent.set(folder.parent, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.order - b.order);

  const out: FolderOption[] = [];
  function walk(parent: string | null): void {
    for (const folder of byParent.get(parent) ?? []) {
      const depth = folderPath(folders, folder.id).length - 1;
      out.push({ id: folder.id, label: `${' '.repeat(depth * 2)}${folder.name}` });
      walk(folder.id);
    }
  }
  walk(null);
  return out;
}

/**
 * Whether the editor's save button can be pressed. In amend mode only the
 * title matters — amend never touches filing links (see fix brief). In
 * create mode a folder must also be chosen, unless the archive has no
 * folders at all: a fresh archive must not trap the user into leaving the
 * editor to create one first, so an empty archive allows unfiled creation.
 */
export function canSaveDocument(params: {
  mode: 'create' | 'amend';
  title: string;
  folderId: string | null;
  hasFolders: boolean;
}): boolean {
  if (!params.title.trim()) return false;
  if (params.mode === 'create' && params.hasFolders && !params.folderId) return false;
  return true;
}
