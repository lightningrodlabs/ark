import type { ActionHash } from '@holochain/client';
import { ArkIndex, type SearchFilters, type SearchHit } from '../search/index';
import { parseQuery } from '../search/query';
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
  // Search is global unless the user explicitly opts in to a folder scope —
  // it must never be inherited from whatever happens to be selected in the
  // tree (that was the reported bug: a search silently scoped to the
  // selected folder returned nothing because the archive's 1406 documents
  // were not all filed there). `label` is carried alongside the id purely so
  // the search bar can render "in <label>" without reaching back into the
  // tree once the scope has latched — see SearchBar's `enableScope`.
  folderScope = $state<{ id: string; label: string } | null>(null);

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

  /**
   * Index a page of documents as it arrives, so the initial load leaves a
   * complete index behind instead of needing a `rebuild()` pass at the end
   * over a corpus that is already in memory. Idempotent — see
   * `ArkIndex.upsert` — because a page can arrive twice.
   */
  upsertAll(docs: DocumentSummary[]): void {
    this.index.upsertAll(docs);
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

  private filters(folders: Folder[], folderId: string | null): SearchFilters {
    return {
      folderId,
      folders,
      from: this.from,
      to: this.to,
      author: this.author,
      includeTrashed: this.includeTrashed,
    };
  }

  /** Runs the current query, scoped to `folderScope` when one is set — never
   * to whatever is merely selected in the tree. */
  run(folders: Folder[]): SearchHit[] {
    return this.index.search(this.query, this.filters(folders, this.folderScope?.id ?? null));
  }

  /**
   * The literal strings the current query asks to see marked — phrases
   * whole, exclusions never. Captured when a result is opened so the
   * document that was landed on can highlight exactly what matched; the
   * view layer stays out of the query parser the same way it stays out of
   * the index.
   */
  highlightTerms(): string[] {
    return parseQuery(this.query).highlight;
  }

  /**
   * How many hits the current query would have with no folder scope. Used
   * only to power the scoped-zero-results fallback ("N found in the whole
   * archive — search everywhere?") — a scoped search that comes up empty
   * must say so and offer the way out rather than going quiet, which is a
   * milder form of the same bug this store exists to prevent.
   */
  unscopedCount(folders: Folder[]): number {
    if (!this.folderScope) return 0;
    return this.index.search(this.query, this.filters(folders, null)).length;
  }
}
