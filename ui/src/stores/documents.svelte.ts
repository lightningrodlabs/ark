import { encodeHashToBase64, type ActionHash } from '@holochain/client';
import { ARK_CHUNK, type ArkClient } from '../ark-client';
import type { ArkSignal, DocumentSummary, Folder } from '../types';
import { descendantIds } from '../tree/paths';
import { deadFolders } from '../tree/merge';
import { sameDocuments, sameFilings, sameKeys } from './diff';

/** Map key for any hash. Uint8Array is not usable as a Map key by value. */
export const key = (hash: ActionHash): string => encodeHashToBase64(hash);

export interface DeletedFolderBin {
  folder: Folder;
  documents: DocumentSummary[];
}

export interface SyncResult {
  /** Whether anything actually changed — documents, filings, or trash. */
  changed: boolean;
  /** Newly-fetched documents the caller should `upsert` into the search index. */
  upserted: DocumentSummary[];
  /** Documents no longer present remotely, for the caller to `remove` from the
   * search index. */
  departed: ActionHash[];
  /**
   * True when the delta was too large for individual `getDocument` calls and
   * `load()` ran instead. `upserted`/`departed` are empty in this case — the
   * caller should rebuild the index rather than try to apply them.
   */
  fellBack: boolean;
}

/**
 * Every document in memory. The archive is small enough that this is simply the
 * whole corpus — about 5 MB of text for the reference workload — which is what
 * makes client-side search possible at all.
 */
export class DocumentStore {
  byOriginal = $state(new Map<string, DocumentSummary>());
  /** document key → folder id, or null when filed nowhere. */
  filings = $state(new Map<string, string | null>());
  trashed = $state(new Set<string>());
  loaded = $state(0);
  total: number | null = $state(null);
  /**
   * Hashes the AllDocuments anchor knows about but that never resolved
   * locally on this device, after `load` finished paging through the whole
   * anchor. Every read here is local (`GetOptions::local()`), so "holds the
   * link but not yet the entry" is the normal state of a peer that just
   * joined a group with an imported archive — this is how that peer finds
   * out its view is partial instead of silently seeing a truncated corpus.
   */
  missing = $state(0);
  /**
   * True while the very first `load()` is still paging the archive in.
   *
   * The app renders around this rather than instead of it: the tree, the
   * toolbar and every document already paged in are live and usable, and this
   * only drives the progress banner, suppresses the Unfiled bin (a document
   * whose page has not arrived is indistinguishable from an unfiled one) and
   * holds search back until the index covers the whole corpus. Later loads —
   * the reconcile backstop — never set it: they run over data that is already
   * on screen and complete, and there is nothing to warn about.
   */
  loading = $state(false);
  /** Folder list from the last load, so filings can be re-read without it. */
  private lastFolders: Folder[] = [];

  constructor(
    private ark: ArkClient,
    private chunk: number = ARK_CHUNK,
  ) {}

  /**
   * Pages through the entire AllDocuments anchor, not just until a page comes
   * back short. A page can be short because some of its hashes have not
   * resolved locally yet — links and entries gossip independently — and a
   * short page is NOT the same thing as the last page. Paging on `total`
   * (reported by the zome from the anchor's actual link count) rather than on
   * page length is what keeps an unresolved hash near the front of the
   * archive from truncating everything after it.
   */
  async load(
    folders: Folder[],
    onChunk?: (loaded: number, total: number) => void,
  ): Promise<boolean> {
    // A cold start has never recorded a total. Only then is the growing,
    // partial map worth publishing: it drives the "Loading documents… N"
    // counter while there is nothing else on screen. On every later call —
    // and the five-minute backstop reconcile is the overwhelmingly common
    // case — publishing partial pages would repaint the whole view once per
    // 100-document page, each repaint briefly showing a TRUNCATED archive,
    // before landing back on data identical to what was already there.
    const cold = this.total === null;
    if (cold) this.loading = true;
    try {
      // Filings and trash FIRST on a cold start. Each is one call covering the
      // whole archive regardless of which documents have been paged in, so
      // reading them up front means every document lands in its folder the
      // moment it arrives. Read afterwards instead — as the non-cold path
      // still does — the growing corpus spends the whole load looking unfiled,
      // which is the state the Unfiled bin's "Move all here" would offer to
      // act on.
      if (cold) {
        await this.loadFilings(folders);
        await this.loadTrashed();
      }

      const byOriginal = new Map<string, DocumentSummary>();
      let total = Infinity;
      for (let offset = 0; offset < total; offset += this.chunk) {
        const page = await this.ark.getAllDocuments(offset, this.chunk);
        total = page.total;
        for (const doc of page.documents) byOriginal.set(key(doc.original), doc);
        if (cold) {
          this.byOriginal = new Map(byOriginal);
          this.loaded = byOriginal.size;
          // Published from the first page on, so the progress banner can say
          // "N of M" instead of counting up towards an unknown ceiling. `cold`
          // was captured before the loop, so writing it here does not turn the
          // rest of this load into a warm one.
          this.total = total;
        }
        // `total` is the anchor's own count, reported alongside the first
        // page, so a caller counting a warm load — which publishes nothing
        // reactive — still has both halves of "N of M".
        onChunk?.(byOriginal.size, total);
      }

      // Assign only on a real difference. `$state` compares by reference for
      // objects, so handing it an equal-but-new Map is indistinguishable from a
      // genuine change and invalidates every derivation downstream — the whole
      // document list, folder counts, orphan bins and trash view.
      let changed = false;
      if (!sameDocuments(this.byOriginal, byOriginal)) {
        this.byOriginal = byOriginal;
        changed = true;
      }
      this.loaded = byOriginal.size;
      this.total = total;
      this.missing = total - byOriginal.size;
      if (await this.loadFilings(folders)) changed = true;
      if (await this.loadTrashed()) changed = true;
      return changed;
    } finally {
      if (cold) this.loading = false;
    }
  }

  /**
   * Incremental counterpart to `load()`. `get_document_hashes` reads links
   * only and resolves no entries, so it stays cheap at corpus scale; this
   * fetches individually only the documents that are new since the last sync,
   * and drops ones that departed, instead of re-paging all 1406 to discover
   * the same one-document delta.
   *
   * Above `this.chunk` missing documents — the same page size `load()` uses —
   * fetching each one individually would cost more round trips than one paged
   * reload, and a peer that far behind is the pathological case (a cold start,
   * or one that has been offline a long time): falls back to `load()`.
   *
   * Does not touch the search index itself — `upserted`/`departed` tell the
   * caller what changed so it can apply the existing `SearchStore`
   * pass-throughs (`upsert`/`remove`) rather than rebuilding, which is the
   * expensive half of a reconcile and repaints every search result as a side
   * effect even for a single new document.
   */
  async syncMissing(
    folders: Folder[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<SyncResult> {
    const hashes = await this.ark.getDocumentHashes();
    const remoteKeys = new Set(hashes.map(key));
    const missingHashes = hashes.filter((h) => !this.byOriginal.has(key(h)));
    const departed = [...this.byOriginal.values()].filter(
      (doc) => !remoteKeys.has(key(doc.original)),
    );

    if (missingHashes.length > this.chunk) {
      // The paged reload is the long one — fifteen round trips on the
      // reference archive — so it is the one that most needs to be reported.
      const changed = await this.load(folders, onProgress);
      return { changed, upserted: [], departed: [], fellBack: true };
    }

    if (missingHashes.length === 0 && departed.length === 0) {
      const filingsChanged = await this.loadFilings(folders);
      const trashedChanged = await this.loadTrashed();
      return {
        changed: filingsChanged || trashedChanged,
        upserted: [],
        departed: [],
        fellBack: false,
      };
    }

    let done = 0;
    const fetched = await Promise.all(
      missingHashes.map(async (h) => {
        const doc = await this.ark.getDocument(h);
        onProgress?.((done += 1), missingHashes.length);
        return doc;
      }),
    );
    const next = new Map(this.byOriginal);
    for (const doc of departed) next.delete(key(doc.original));
    const upserted: DocumentSummary[] = [];
    for (const doc of fetched) {
      if (doc) {
        next.set(key(doc.original), doc);
        upserted.push(doc);
      }
    }
    // Assigned once, not once per fetched document — this is the map
    // reassignment that repaints reactive views, so it happens exactly once
    // regardless of how many documents were missing.
    this.byOriginal = next;
    this.loaded = next.size;
    this.total = hashes.length;
    this.missing = hashes.length - next.size;

    await this.loadFilings(folders);
    await this.loadTrashed();

    return { changed: true, upserted, departed: departed.map((d) => d.original), fellBack: false };
  }

  /**
   * Filings are read for every folder id including tombstoned ones — that is
   * what makes documents under a deleted folder findable rather than lost.
   */
  async loadFilings(folders: Folder[]): Promise<boolean> {
    this.lastFolders = folders;
    const filings = new Map<string, string | null>();
    for (const original of this.byOriginal.keys()) filings.set(original, null);
    const results = await this.ark.getFilings(folders.map((f) => f.id));
    for (const filing of results) {
      for (const doc of filing.documents) filings.set(key(doc), filing.folder_id);
    }
    if (sameFilings(this.filings, filings)) return false;
    this.filings = filings;
    return true;
  }

  async loadTrashed(): Promise<boolean> {
    const trashed = new Set((await this.ark.getTrashed()).map(key));
    if (sameKeys(this.trashed, trashed)) return false;
    this.trashed = trashed;
    return true;
  }

  /**
   * Cheap backstop check for a focus-triggered reconcile: two small calls
   * (`get_all_documents` with `limit: 0`, which returns just the anchor's
   * link count, and `get_trashed`, which returns hashes with no document
   * bodies) instead of pulling every document.
   *
   * Compared against `this.total` — the total recorded at the last full
   * load — not against `byOriginal.size`. A peer that is permanently short a
   * document or two (see `missing`) would otherwise see `byOriginal.size`
   * stay below the remote total on every check and never get the fast path;
   * comparing to the previously-recorded total means only a genuine new
   * document trips it. The trash side mirrors this with `this.trashed.size`.
   *
   * The trash side compares *membership*, not just the count. `get_trashed`
   * already returns the hashes, so the set comparison is free, and it closes
   * what used to be a real blind spot: one document trashed and a different
   * one restored in the same window leaves the count identical while the
   * membership has entirely moved.
   *
   * What remains invisible here is an AMENDMENT. It creates no link on the
   * AllDocuments anchor and touches no trash link, so neither the total nor
   * the trash set moves, and no amount of sharpening this check will see it.
   * That single remaining gap is what the periodic unconditional sweep in
   * `reconcile.ts` exists to close.
   */
  async changedSince(): Promise<boolean> {
    const [remote, trashed] = await Promise.all([
      this.ark.getAllDocuments(0, 0),
      this.ark.getTrashed(),
    ]);
    if (remote.total !== this.total) return true;
    if (!sameKeys(new Set(trashed.map(key)), this.trashed)) return true;
    return false;
  }

  async refreshDocument(original: ActionHash): Promise<void> {
    const doc = await this.ark.getDocument(original);
    if (!doc) return;
    const next = new Map(this.byOriginal);
    next.set(key(original), doc);
    this.byOriginal = next;
  }

  /**
   * Re-read the folder each document is filed under, using the folder list from
   * the last load. Creating a document writes a filing LINK, which
   * `refreshDocument` does not see — without this a document filed into a
   * folder stays invisible there until the app reloads.
   */
  async refreshFilings(): Promise<void> {
    await this.loadFilings(this.lastFolders);
  }

  /** Documents filed in this folder or any descendant, trashed ones excluded. */
  inFolder(folderId: string, folders: Folder[]): DocumentSummary[] {
    const ids = new Set(descendantIds(folders, folderId));
    return [...this.byOriginal.entries()]
      .filter(([k]) => !this.trashed.has(k))
      .filter(([k]) => {
        const folder = this.filings.get(k);
        return folder !== null && folder !== undefined && ids.has(folder);
      })
      .map(([, doc]) => doc);
  }

  /**
   * Documents filed in exactly this folder, trashed ones excluded, newest
   * first.
   *
   * The tree renders a folder's documents as its leaf children, and its
   * sub-folders as its branch children, so it needs the documents filed
   * DIRECTLY here — `inFolder` includes descendants, which in a tree would
   * list every document again at every level above it.
   */
  directlyIn(folderId: string): DocumentSummary[] {
    return [...this.byOriginal.entries()]
      .filter(([k]) => !this.trashed.has(k) && this.filings.get(k) === folderId)
      .map(([, doc]) => doc)
      .sort((a, b) => (b.meta.date ?? '').localeCompare(a.meta.date ?? ''));
  }

  counts(folders: Folder[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const folder of folders) out[folder.id] = this.inFolder(folder.id, folders).length;
    return out;
  }

  /** No folder link at all — never filed, or filed under an id no head knows. */
  unfiled(): DocumentSummary[] {
    return [...this.byOriginal.entries()]
      .filter(([k]) => !this.trashed.has(k) && !this.filings.get(k))
      .map(([, doc]) => doc);
  }

  /**
   * One bin per dead folder that still has documents filed directly under it —
   * "dead" meaning tombstoned itself OR a descendant of a tombstoned folder.
   * A document filed under a live-flagged child of a deleted parent is in no
   * live folder and would otherwise be reachable only through "All documents"
   * or search, with no way to re-file it.
   */
  inDeletedFolders(folders: Folder[]): DeletedFolderBin[] {
    return deadFolders(folders)
      .map((folder) => ({
        folder,
        documents: [...this.byOriginal.entries()]
          .filter(([k]) => !this.trashed.has(k) && this.filings.get(k) === folder.id)
          .map(([, doc]) => doc),
      }))
      .filter((bin) => bin.documents.length > 0);
  }

  async applySignal(signal: ArkSignal): Promise<void> {
    switch (signal.type) {
      case 'DocumentAmended':
        await this.refreshDocument(signal.original);
        break;
      case 'DocumentCreated':
        // Also re-read filings: a document created by another peer arrives with
        // a filing LINK that refreshDocument cannot see, so without this it
        // shows up in "all documents" but not in the folder someone filed it
        // into — the same gap the editor path had, on the remote side.
        await this.refreshDocument(signal.original);
        await this.refreshFilings();
        break;
      case 'DocumentTrashed': {
        const next = new Set(this.trashed);
        next.add(key(signal.original));
        this.trashed = next;
        break;
      }
      case 'DocumentRestored': {
        const next = new Set(this.trashed);
        next.delete(key(signal.original));
        this.trashed = next;
        break;
      }
      case 'DocumentMoved': {
        const next = new Map(this.filings);
        next.set(key(signal.original), signal.to);
        this.filings = next;
        break;
      }
      case 'TreeUpdated':
        break;
    }
  }
}
