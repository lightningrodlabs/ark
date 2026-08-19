import { encodeHashToBase64, type ActionHash } from '@holochain/client';
import { ARK_CHUNK, type ArkClient } from '../ark-client';
import type { ArkSignal, DocumentSummary, Folder } from '../types';
import { descendantIds } from '../tree/paths';

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

  constructor(
    private ark: ArkClient,
    private chunk: number = ARK_CHUNK,
  ) {}

  async load(folders: Folder[], onChunk?: (loaded: number) => void): Promise<void> {
    const byOriginal = new Map<string, DocumentSummary>();
    for (let offset = 0; ; offset += this.chunk) {
      const page = await this.ark.getAllDocuments(offset, this.chunk);
      for (const doc of page) byOriginal.set(key(doc.original), doc);
      this.byOriginal = new Map(byOriginal);
      this.loaded = byOriginal.size;
      onChunk?.(byOriginal.size);
      if (page.length < this.chunk) break;
    }
    this.total = byOriginal.size;
    await this.loadFilings(folders);
    await this.loadTrashed();
  }

  /**
   * Filings are read for every folder id including tombstoned ones — that is
   * what makes documents under a deleted folder findable rather than lost.
   */
  async loadFilings(folders: Folder[]): Promise<void> {
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

  /** One bin per tombstoned folder that still has documents filed under it. */
  inDeletedFolders(folders: Folder[]): DeletedFolderBin[] {
    return folders
      .filter((f) => f.deleted)
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
      case 'DocumentCreated':
      case 'DocumentAmended':
        await this.refreshDocument(signal.original);
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
