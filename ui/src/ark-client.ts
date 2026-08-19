import type { ActionHash, AgentPubKey, AppClient, EntryHash } from '@holochain/client';
import { toPlain } from './plain';
import type {
  ArkSignal,
  DocumentSummary,
  DocumentVersion,
  Folder,
  FolderFiling,
  GetAllOutput,
  Meta,
  TreeHead,
} from './types';

export const ROLE_NAME = 'ark';
export const ZOME_NAME = 'ark';
/** Documents fetched per round trip during the initial load. */
export const ARK_CHUNK = 100;

/**
 * The only place in the UI that knows zome function names. Payload field names
 * are snake_case on both sides — there is deliberately no case-conversion layer,
 * because a silent rename between Rust and TS is the kind of bug that only shows
 * up at runtime.
 */
export class ArkClient {
  constructor(
    public client: AppClient,
    public roleName: string = ROLE_NAME,
    public zomeName: string = ZOME_NAME,
  ) {}

  private call<T>(fn_name: string, payload: unknown): Promise<T> {
    return this.client.callZome({
      role_name: this.roleName,
      zome_name: this.zomeName,
      fn_name,
      // Every payload is stripped of reactive proxies here rather than at each
      // call site. Inside Moss the call crosses an iframe bridge that
      // structured-clones it, and a `$state`-backed array or object is a Proxy,
      // which cannot be cloned. Doing it once means a future extern cannot
      // reintroduce the bug by passing store state straight through.
      payload: toPlain(payload),
    }) as Promise<T>;
  }

  createDocument(input: {
    body: string;
    meta: Meta;
    folder_id: string | null;
  }): Promise<ActionHash> {
    return this.call('create_document', input);
  }

  amendDocument(input: { original: ActionHash; body: string; meta: Meta }): Promise<ActionHash> {
    return this.call('amend_document', input);
  }

  getDocument(original: ActionHash): Promise<DocumentSummary | null> {
    return this.call('get_document', original);
  }

  getAllDocuments(offset: number, limit: number): Promise<GetAllOutput> {
    return this.call('get_all_documents', { offset, limit });
  }

  /** Links only, no entries resolved — cheap even at corpus scale. */
  getDocumentHashes(): Promise<ActionHash[]> {
    return this.call('get_document_hashes', null);
  }

  getDocumentVersions(original: ActionHash): Promise<DocumentVersion[]> {
    return this.call('get_document_versions', original);
  }

  moveDocument(input: {
    original: ActionHash;
    from: string | null;
    to: string | null;
  }): Promise<null> {
    return this.call('move_document', input);
  }

  getFilings(folderIds: string[]): Promise<FolderFiling[]> {
    return this.call('get_filings', folderIds);
  }

  getFolderTree(): Promise<TreeHead[]> {
    return this.call('get_folder_tree', null);
  }

  updateFolderTree(folders: Folder[]): Promise<ActionHash> {
    return this.call('update_folder_tree', { folders });
  }

  trashDocument(original: ActionHash): Promise<null> {
    return this.call('trash_document', original);
  }

  restoreDocument(original: ActionHash): Promise<null> {
    return this.call('restore_document', original);
  }

  getTrashed(): Promise<ActionHash[]> {
    return this.call('get_trashed', null);
  }

  attachFile(original: ActionHash, file_hash: EntryHash): Promise<null> {
    return this.call('attach_file', { original, file_hash });
  }

  detachFile(original: ActionHash, file_hash: EntryHash): Promise<null> {
    return this.call('detach_file', { original, file_hash });
  }

  getAttachments(original: ActionHash): Promise<EntryHash[]> {
    return this.call('get_attachments', original);
  }

  notifyPeers(peers: AgentPubKey[], signal: ArkSignal): Promise<null> {
    return this.call('notify_peers', { peers, signal });
  }

  whoami(): Promise<AgentPubKey> {
    return this.call('whoami', null);
  }
}
