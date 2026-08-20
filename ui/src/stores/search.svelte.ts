import type { ActionHash } from '@holochain/client';
import {
  ArkIndex,
  type NearMatchMode,
  type SearchFilters,
  type SearchHit,
  type SearchOutcome,
} from '../search/index';
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
  /**
   * How far a search may reach past what was typed — see `NearMatchMode`.
   *
   * `fallback` by default, and that default is load-bearing: the second pass
   * only runs when the first found nothing, so an ordinary query costs
   * exactly what it did before. `always` is the deliberate opt-in that finds
   * a misspelling living in the archive, and it is a mode the user has to
   * choose, because it also finds `bean` when you ask for `jean`.
   *
   * Here beside `from`/`to`/`author` rather than in the view, so every path
   * that runs a search — including `unscopedCount` — asks the same question.
   */
  nearMatches = $state<NearMatchMode>('fallback');
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
      nearMatches: this.nearMatches,
    };
  }

  /** Runs the current query, scoped to `folderScope` when one is set — never
   * to whatever is merely selected in the tree. */
  run(folders: Folder[]): SearchOutcome {
    return this.index.search(this.query, this.filters(folders, this.folderScope?.id ?? null));
  }

  /**
   * The strings to mark in the document a hit opens.
   *
   * Taken from the hit, not re-derived from the query. Re-parsing the query
   * was right only while every hit was guaranteed to contain it: a
   * near-match hit for `asdf` matched the index term `asif`, so a document
   * opened from it marked nothing — the same blank result the snippet bug
   * showed, in a second place. The hit already carries what it matched, and
   * that is the one list both highlight paths must agree on.
   */
  highlightTerms(hit: SearchHit): string[] {
    return hit.highlight;
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
    return this.index.search(this.query, this.filters(folders, null)).hits.length;
  }
}
