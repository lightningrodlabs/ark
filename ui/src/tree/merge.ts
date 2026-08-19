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
  return [...winner.values()]
    .map((w) => w.folder)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * Folders a user should see: tombstones removed, along with anything beneath a
 * tombstone. Deleting a folder therefore hides its whole subtree without
 * needing a recursive write.
 */
export function liveFolders(folders: Folder[]): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const isDead = (folder: Folder): boolean => {
    const seen = new Set<string>();
    let current: Folder | undefined = folder;
    while (current && !seen.has(current.id)) {
      if (current.deleted) return true;
      seen.add(current.id);
      current = current.parent ? byId.get(current.parent) : undefined;
    }
    return false;
  };
  return folders.filter((f) => !isDead(f));
}
