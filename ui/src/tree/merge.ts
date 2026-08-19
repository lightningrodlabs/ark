import type { Folder, TreeHead } from '../types';

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Union every head's folders by id. Where an id appears in more than one head,
 * the newest action wins; timestamp ties break on action-hash bytes so every
 * peer computes the same tree from the same data.
 *
 * Deletion is a `deleted` flag rather than absence precisely because this is a
 * union: a folder removed from one head's list would be resurrected by any
 * concurrent head that still carried it.
 */
export function mergeHeads(heads: TreeHead[]): Folder[] {
  const winner = new Map<string, { folder: Folder; timestamp: number; action: Uint8Array }>();
  for (const head of heads) {
    const action = head.action as unknown as Uint8Array;
    for (const folder of head.folders) {
      const held = winner.get(folder.id);
      const beats =
        !held ||
        head.timestamp > held.timestamp ||
        (head.timestamp === held.timestamp && compareBytes(action, held.action) > 0);
      if (beats) winner.set(folder.id, { folder, timestamp: head.timestamp, action });
    }
  }
  // Fixed locale, not the peer's default: unicode collation varies by locale, so
  // an unqualified localeCompare could order two folders differently on two
  // machines. Display order is part of "every peer computes the same tree".
  return [...winner.values()]
    .map((w) => w.folder)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'en'));
}

/**
 * Folders a user should see: tombstones removed, along with anything beneath a
 * tombstone. Deleting a folder therefore hides its whole subtree without
 * needing a recursive write.
 */
export function liveFolders(folders: Folder[]): Folder[] {
  const isDead = deadPredicate(folders);
  return folders.filter((f) => !isDead(f));
}

/**
 * Folders hidden from the tree: tombstoned folders themselves, and anything
 * beneath a tombstone (a live-flagged child of a deleted parent counts as
 * dead here too). Complement of `liveFolders`, and the predicate the orphan
 * bin uses so a document filed under a tombstoned *subtree* — not just a
 * tombstoned folder directly — still gets a bin to land in.
 */
export function deadFolders(folders: Folder[]): Folder[] {
  const isDead = deadPredicate(folders);
  return folders.filter((f) => isDead(f));
}

function deadPredicate(folders: Folder[]): (folder: Folder) => boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  return (folder: Folder): boolean => {
    const seen = new Set<string>();
    let current: Folder | undefined = folder;
    while (current && !seen.has(current.id)) {
      if (current.deleted) return true;
      seen.add(current.id);
      current = current.parent ? byId.get(current.parent) : undefined;
    }
    return false;
  };
}

/**
 * Whether two merged trees are identical field for field.
 *
 * `mergeHeads` sorts deterministically, so a positional walk is enough — two
 * equal trees can never come back in different orders. Used by TreeStore.load
 * to avoid replacing the reactive folder array (and so repainting the whole
 * folder pane) on a reconcile that found nothing new.
 */
export function sameFolders(a: Folder[], b: Folder[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.parent !== y.parent ||
      x.order !== y.order ||
      x.deleted !== y.deleted
    )
      return false;
  }
  return true;
}
