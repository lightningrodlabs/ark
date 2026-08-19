import { ArkIndex, type SearchFilters, type SearchHit } from '../search/index';
import type { DocumentStore } from './documents.svelte';
import type { Folder } from '../types';

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
