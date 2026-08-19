import { encodeHashToBase64, type ActionHash } from '@holochain/client';
import { ARK_CHUNK, type ArkClient } from '../ark-client';
import type { ArkSignal, DocumentSummary, Folder } from '../types';
import { descendantIds } from '../tree/paths';
import { deadFolders } from '../tree/merge';

/** Map key for any hash. Uint8Array is not usable as a Map key by value. */
export const key = (hash: ActionHash): string => encodeHashToBase64(hash);

export interface DeletedFolderBin {
  folder: Folder;
  documents: DocumentSummary[];
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
  async load(folders: Folder[], onChunk?: (loaded: number) => void): Promise<void> {
    const byOriginal = new Map<string, DocumentSummary>();
    let total = Infinity;
    for (let offset = 0; offset < total; offset += this.chunk) {
      const page = await this.ark.getAllDocuments(offset, this.chunk);
      total = page.total;
      for (const doc of page.documents) byOriginal.set(key(doc.original), doc);
      this.byOriginal = new Map(byOriginal);
      this.loaded = byOriginal.size;
      onChunk?.(byOriginal.size);
    }
    this.total = total;
    this.missing = total - byOriginal.size;
    await this.loadFilings(folders);
    await this.loadTrashed();
  }

  /**
   * Filings are read for every folder id including tombstoned ones — that is
   * what makes documents under a deleted folder findable rather than lost.
   */
  async loadFilings(folders: Folder[]): Promise<void> {
    this.lastFolders = folders;
    const filings = new Map<string, string | null>();
    for (const original of this.byOriginal.keys()) filings.set(original, null);
    const results = await this.ark.getFilings(folders.map((f) => f.id));
    for (const filing of results) {
      for (const doc of filing.documents) filings.set(key(doc), filing.folder_id);
    }
    this.filings = filings;
  }

  async loadTrashed(): Promise<void> {
    this.trashed = new Set((await this.ark.getTrashed()).map(key));
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
