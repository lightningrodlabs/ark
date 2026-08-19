import type { ActionHash } from '@holochain/client';
import type { Folder, FolderFiling } from '../types';
import { descendantIds } from './paths';

export interface FolderDeletionPlan {
  tombstone: string[];
  moves: { original: ActionHash; from: string; to: string | null }[];
}

/**
 * Deleting a folder relocates the documents inside it to the deleted folder's
 * parent — or unfiles them when it has no parent — and tombstones the whole
 * subtree. Documents are never touched as entries; only their filing links move,
 * so no version is created.
 */
export function planFolderDeletion(
  folders: Folder[],
  filings: FolderFiling[],
  id: string,
): FolderDeletionPlan {
  const doomed = descendantIds(folders, id);
  if (doomed.length === 0) return { tombstone: [], moves: [] };
  const destination = folders.find((f) => f.id === id)?.parent ?? null;
  const moves = filings
    .filter((filing) => doomed.includes(filing.folder_id))
    .flatMap((filing) =>
      filing.documents.map((original) => ({
        original,
        from: filing.folder_id,
        to: destination,
      })),
    );
  return { tombstone: doomed, moves };
}
