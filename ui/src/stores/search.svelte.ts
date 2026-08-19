import type { ActionHash } from '@holochain/client';
import { ArkIndex, type SearchFilters, type SearchHit } from '../search/index';
import type { DocumentStore } from './documents.svelte';
import type { DocumentSummary, Folder } from '../types';

/** Keeps one ArkIndex in step with the DocumentStore. */
export class SearchStore {
  index = new ArkIndex();
  query = $state('');
  from = $state<string | null>(null);
  to = $state<string | null>(null);
  author = $state<string | null>(null);
  includeTrashed = $state(false);

  constructor(private documents: DocumentStore) {}

  rebuild(): void {
    this.index.rebuild([...this.documents.byOriginal.values()]);
    this.index.setFilings(this.documents.filings);
    this.index.setTrashed(this.documents.trashed);
  }

  sync(): void {
    this.index.setFilings(this.documents.filings);
    this.index.setTrashed(this.documents.trashed);
  }

  /** Re-index one document. Keeps callers out of `index` directly. */
  upsert(doc: DocumentSummary): void {
    this.index.upsert(doc);
  }

  /** Drop a document that is no longer in the corpus. Keeps callers out of
   * `index` directly. */
  remove(original: ActionHash): void {
    this.index.remove(original);
  }

  /** Index an attachment's text under its parent document. Keeps callers out
   * of `index` directly. */
  setAttachmentText(original: ActionHash, name: string, text: string): void {
    this.index.setAttachmentText(original, name, text);
  }

  /** Forget an attachment's text, e.g. when it is detached. Keeps callers out
   * of `index` directly. */
  removeAttachmentText(original: ActionHash, name: string): void {
    this.index.removeAttachmentText(original, name);
  }

  run(folderId: string | null, folders: Folder[]): SearchHit[] {
    const filters: SearchFilters = {
      folderId,
      folders,
      from: this.from,
      to: this.to,
      author: this.author,
      includeTrashed: this.includeTrashed,
    };
    return this.index.search(this.query, filters);
  }
}
