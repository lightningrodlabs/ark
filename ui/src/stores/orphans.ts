import type { DocumentSummary, Folder } from '../types';
import type { DocumentStore } from './documents.svelte';

export interface TrashEntry {
  doc: DocumentSummary;
  /** Display name of the folder it was filed in, or null if it was unfiled. */
  wasIn: string | null;
}

/**
 * Trashing leaves the filing link in place, so the trash view can say where a
 * document came from and restore puts it back there. Trashed documents never
 * appear in an orphan bin as well — trash wins, so nothing is listed twice.
 */
export function trashEntries(store: DocumentStore, folders: Folder[]): TrashEntry[] {
  return [...store.byOriginal.entries()]
    .filter(([id]) => store.trashed.has(id))
    .map(([id, doc]) => {
      const folderId = store.filings.get(id) ?? null;
      const folder = folderId ? folders.find((f) => f.id === folderId) : undefined;
      return { doc, wasIn: folder?.name ?? null };
    });
}
