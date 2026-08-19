/**
 * An in-memory stand-in for the `ark` zome, used only by the Playwright
 * harness (see README.md in this directory). It implements the same surface
 * `ArkClient` calls through `AppClient.callZome`, closely enough to the Rust
 * externs in `dnas/ark/zomes/coordinator/ark/src/*.rs` that the real
 * component tree — stores, search, everything above the DNA boundary — runs
 * unmodified against it.
 *
 * Deliberately NOT a faithful re-implementation of the DHT: no multi-agent
 * head forking, no CRDT-style tip merging for the folder tree (there is
 * exactly one writer in these tests, so a single current tip is enough), no
 * gossip delay. It plays back the single-agent happy path the Rust code
 * takes when there is no concurrency, which is what a solo run through the
 * UI actually exercises.
 */
import { encodeHashToBase64, type ActionHash, type AgentPubKey, type EntryHash } from '@holochain/client';
import type { DocumentSummary, DocumentVersion, Folder, FolderFiling, GetAllOutput, Meta, TreeSnapshot } from '../src/types';

/** Minimal shape `ArkClient`/`SignalStore`/`App.svelte` actually use. */
export interface StubAppClient {
  myPubKey: AgentPubKey;
  /**
   * Just enough of `AppClient.appInfo()` for the two callers that read it:
   * the "Add to pocket" WALs and the About dialog, both of which want the
   * provisioned `ark` cell's DNA hash. Not a zome call, so it never lands in
   * `calls`.
   */
  appInfo(): Promise<{
    agent_pub_key: AgentPubKey;
    installed_app_id: string;
    cell_info: Record<string, { type: 'provisioned'; value: { cell_id: [Uint8Array, AgentPubKey] } }[]>;
  }>;
  callZome(request: { role_name: string; zome_name: string; fn_name: string; payload: unknown }): Promise<unknown>;
  on(event: string, cb: (signal: unknown) => void): () => void;
  /**
   * Every zome fn name this client has been asked to call, in order. Exists
   * only for tests: the asset-view harness seam asserts `get_all_documents`
   * is never in here, which is what keeps "an asset view must not boot the
   * app" an enforced property rather than a comment. Production `AppClient`
   * has no such field — nothing in `src/` reads it.
   */
  calls: string[];
  /**
   * Test-only seam for the "node has documents but not the folder structure"
   * scenario: makes `get_folder_tree` report the root link without its tip
   * (`{ root_count: 1, heads: [] }`) even though folders/filings already
   * exist internally. No-op if `update_folder_tree` was never called — there
   * is no root to withhold.
   */
  simulateStructurePending(): void;
  /** Reverses `simulateStructurePending`, as a reconcile arriving would. */
  resolveStructure(): void;
}

let counter = 0;
/** A fresh, distinguishable fake hash. Byte layout is irrelevant off-DHT. */
function nextHash(): Uint8Array {
  counter += 1;
  const bytes = new Uint8Array(39);
  new DataView(bytes.buffer).setUint32(0, counter);
  return bytes;
}

interface VersionRecord {
  action: ActionHash;
  author: AgentPubKey;
  timestamp: number;
  body: string;
  meta: Meta;
}

interface DocRecord {
  original: ActionHash;
  createdAt: number;
  /** Oldest first; current version is always last — see amend_document below. */
  versions: VersionRecord[];
}

export function createStubClient(): StubAppClient {
  const myPubKey = nextHash();
  /** Stands in for the ark cell's DNA hash — see appInfo below. */
  const dnaHash = nextHash();

  const documents = new Map<string, DocRecord>();
  /** Creation order, mirroring the AllDocuments anchor's link order. */
  const documentOrder: ActionHash[] = [];
  /** folder id -> set of document keys filed there (mirrors FolderToDocument links). */
  const filings = new Map<string, Set<string>>();
  const trashed = new Set<string>();
  /** document key -> set of attachment (file) keys. */
  const attachments = new Map<string, Set<string>>();
  const fileHashByKey = new Map<string, EntryHash>();

  // file_storage zome stand-in (see ../../../file-storage, branch main-0.7,
  // dnas/file_storage_provider). Content-addressing is not reproduced —
  // like the rest of this stub, chunks and metadata just get a fresh
  // `nextHash()` — but the shapes match what FileStorageClient sends and
  // expects back.
  const fileChunks = new Map<string, Uint8Array>();
  interface StoredFileMetadata {
    name: string;
    last_modified: number;
    size: number;
    file_type: string;
    chunks_hashes: EntryHash[];
  }
  const fileMetadata = new Map<string, StoredFileMetadata>();

  let folders: Folder[] = [];
  let treeExists = false;
  let treeAction: ActionHash = nextHash();
  let treeTimestamp = Date.now();
  /**
   * Test-only: simulates a root LINK that has arrived without its
   * `FolderTree` entry — the DNA state `get_folder_tree` reports as
   * `{ root_count: 1, heads: [] }`. Folders and filings already exist
   * internally when this is set; only what `get_folder_tree` reveals is
   * held back, mirroring a node that has a document's filing link but not
   * yet the tree entry that would let it resolve which folder that is.
   */
  let structurePending = false;

  const key = (hash: ActionHash | EntryHash) => encodeHashToBase64(hash);

  function docSummary(rec: DocRecord): DocumentSummary {
    const latest = rec.versions[rec.versions.length - 1];
    return {
      original: rec.original,
      latest: latest.action,
      author: latest.author,
      created_at: rec.createdAt,
      updated_at: latest.timestamp,
      body: latest.body,
      meta: latest.meta,
    };
  }

  function addFiling(folderId: string, docKey: string): void {
    let set = filings.get(folderId);
    if (!set) {
      set = new Set();
      filings.set(folderId, set);
    }
    set.add(docKey);
  }

  function removeFiling(folderId: string, docKey: string): void {
    filings.get(folderId)?.delete(docKey);
  }

  const handlers: Record<string, (payload: any) => unknown> = {
    create_document: (input: { body: string; meta: Meta; folder_id: string | null }) => {
      const action = nextHash();
      const now = Date.now();
      const rec: DocRecord = {
        original: action,
        createdAt: now,
        versions: [{ action, author: myPubKey, timestamp: now, body: input.body, meta: input.meta }],
      };
      const k = key(action);
      documents.set(k, rec);
      documentOrder.push(action);
      if (input.folder_id) addFiling(input.folder_id, k);
      return action;
    },

    get_document: (original: ActionHash): DocumentSummary | null => {
      const rec = documents.get(key(original));
      return rec ? docSummary(rec) : null;
    },

    get_all_documents: ({ offset, limit }: { offset: number; limit: number }): GetAllOutput => {
      const total = documentOrder.length;
      const page = documentOrder.slice(offset, offset + limit);
      const docs = page
        .map((h) => documents.get(key(h)))
        .filter((r): r is DocRecord => !!r)
        .map(docSummary);
      return { total, documents: docs };
    },

    // Links only, mirroring get_document_hashes's real semantics (see
    // document.rs) — every document the AllDocuments anchor knows about, with
    // no entry resolved. DocumentStore.syncMissing is the one caller; without
    // this handler a reconcile that takes the syncMissing path (any focus or
    // timer tick once tree.structurePending is true, or once changedSince()
    // trips) throws "unhandled zome fn" here and silently abandons the rest
    // of that reconcile — including the filings reload that follows it.
    get_document_hashes: (): ActionHash[] => [...documentOrder],

    amend_document: (input: { original: ActionHash; body: string; meta: Meta }): ActionHash => {
      const rec = documents.get(key(input.original));
      if (!rec) throw new Error('amend_document: no such document');
      const action = nextHash();
      rec.versions.push({ action, author: myPubKey, timestamp: Date.now(), body: input.body, meta: input.meta });
      return action;
    },

    get_document_versions: (original: ActionHash): DocumentVersion[] => {
      const rec = documents.get(key(original));
      if (!rec) return [];
      return rec.versions.map((v) => ({
        action: v.action,
        author: v.author,
        timestamp: v.timestamp,
        body: v.body,
        meta: v.meta,
      }));
    },

    move_document: (input: { original: ActionHash; from: string | null; to: string | null }): null => {
      const k = key(input.original);
      if (input.from) removeFiling(input.from, k);
      if (input.to) addFiling(input.to, k);
      return null;
    },

    get_filings: (folderIds: string[]): FolderFiling[] => {
      return folderIds.map((folder_id) => ({
        folder_id,
        documents: [...(filings.get(folder_id) ?? [])].map((k) => documents.get(k)!.original),
      }));
    },

    get_folder_tree: (): TreeSnapshot => {
      if (!treeExists) return { root_count: 0, heads: [] };
      if (structurePending) return { root_count: 1, heads: [] };
      return { root_count: 1, heads: [{ action: treeAction, timestamp: treeTimestamp, folders }] };
    },

    update_folder_tree: (input: { folders: Folder[] }): ActionHash => {
      folders = input.folders;
      treeExists = true;
      treeAction = nextHash();
      treeTimestamp = Date.now();
      return treeAction;
    },

    trash_document: (original: ActionHash): null => {
      trashed.add(key(original));
      return null;
    },

    restore_document: (original: ActionHash): null => {
      trashed.delete(key(original));
      return null;
    },

    get_trashed: (): ActionHash[] => {
      return [...trashed].map((k) => documents.get(k)!.original);
    },

    attach_file: (input: { original: ActionHash; file_hash: EntryHash }): null => {
      const k = key(input.original);
      let set = attachments.get(k);
      if (!set) {
        set = new Set();
        attachments.set(k, set);
      }
      const fk = key(input.file_hash);
      set.add(fk);
      fileHashByKey.set(fk, input.file_hash);
      return null;
    },

    detach_file: (input: { original: ActionHash; file_hash: EntryHash }): null => {
      attachments.get(key(input.original))?.delete(key(input.file_hash));
      return null;
    },

    get_attachments: (original: ActionHash): EntryHash[] => {
      return [...(attachments.get(key(original)) ?? [])].map((k) => fileHashByKey.get(k)!);
    },

    notify_peers: (): null => null,

    whoami: (): AgentPubKey => myPubKey,

    // FileStorageClient._createChunk sends the raw chunk bytes as the whole
    // payload (Uint8Array), matching how the Rust side's `FileChunk(SerializedBytes)`
    // tuple struct collapses on the wire — there is no wrapper object here.
    create_file_chunk: (bytes: Uint8Array): EntryHash => {
      const hash = nextHash();
      fileChunks.set(key(hash), new Uint8Array(bytes));
      return hash;
    },

    // FileStorageClient.uploadFile sends { name, size, file_type, last_modified, chunks_hashes }.
    create_file_metadata: (input: {
      name: string;
      size: number;
      file_type: string;
      last_modified: number;
      chunks_hashes: EntryHash[];
    }): EntryHash => {
      const hash = nextHash();
      fileMetadata.set(key(hash), {
        name: input.name,
        last_modified: input.last_modified,
        size: input.size,
        file_type: input.file_type,
        chunks_hashes: input.chunks_hashes,
      });
      return hash;
    },

    // FileStorageClient.getFileMetadata/fetchChunk both send { input, local },
    // mirroring the Rust ZomeFnInput<T> wrapper's `local` get-strategy flag —
    // irrelevant here since there is no network to fall back to.
    get_file_metadata: ({ input }: { input: EntryHash; local?: boolean }): StoredFileMetadata => {
      const meta = fileMetadata.get(key(input));
      if (!meta) throw new Error('get_file_metadata: no such file');
      return meta;
    },

    get_file_chunk: ({ input }: { input: EntryHash; local?: boolean }): Uint8Array => {
      const bytes = fileChunks.get(key(input));
      if (!bytes) throw new Error('get_file_chunk: no such chunk');
      return bytes;
    },
  };

  const calls: string[] = [];

  return {
    myPubKey,
    calls,
    async appInfo() {
      return {
        agent_pub_key: myPubKey,
        installed_app_id: 'ark',
        cell_info: {
          ark: [{ type: 'provisioned' as const, value: { cell_id: [dnaHash, myPubKey] as [Uint8Array, AgentPubKey] } }],
        },
      };
    },
    async callZome(request) {
      calls.push(request.fn_name);
      const handler = handlers[request.fn_name];
      if (!handler) throw new Error(`stub-client: unhandled zome fn "${request.fn_name}"`);
      return handler(request.payload);
    },
    simulateStructurePending() {
      structurePending = true;
    },
    resolveStructure() {
      structurePending = false;
    },
    on(_event, _cb) {
      // No peer ever pushes a remote signal in this single-agent stub — every
      // App.svelte flow already applies its own signal locally rather than
      // waiting to hear it echoed back. See SignalStore.start().
      return () => {};
    },
  };
}
