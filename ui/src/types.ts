import type { ActionHash, AgentPubKey, EntryHash } from '@holochain/client';

export type Meta = Record<string, string>;

export interface Folder {
  id: string;
  name: string;
  parent: string | null;
  order: number;
  deleted: boolean;
}

export interface TreeHead {
  action: ActionHash;
  timestamp: number;
  folders: Folder[];
}

/**
 * `get_folder_tree`'s full return. `root_count` is the number of root LINKS
 * `tree_roots()` found on the DNA side; `heads` is however many of those
 * roots' `FolderTree` entries actually resolved locally. The two gossip
 * independently, so `root_count > heads.length` is the exact signal that the
 * tree exists somewhere and simply has not arrived on this device yet — as
 * opposed to `root_count === 0`, which means no folder was ever created.
 */
export interface TreeSnapshot {
  root_count: number;
  heads: TreeHead[];
}

export interface DocumentSummary {
  original: ActionHash;
  latest: ActionHash;
  author: AgentPubKey;
  created_at: number;
  updated_at: number;
  body: string;
  meta: Meta;
}

export interface GetAllOutput {
  total: number;
  documents: DocumentSummary[];
}

export interface DocumentVersion {
  action: ActionHash;
  author: AgentPubKey;
  timestamp: number;
  body: string;
  meta: Meta;
}

export interface FolderFiling {
  folder_id: string;
  documents: ActionHash[];
}

export type ArkSignal =
  | { type: 'DocumentCreated'; original: ActionHash }
  | { type: 'DocumentAmended'; original: ActionHash; new_version: ActionHash }
  | { type: 'DocumentTrashed'; original: ActionHash }
  | { type: 'DocumentRestored'; original: ActionHash }
  | { type: 'DocumentMoved'; original: ActionHash; from: string | null; to: string | null }
  | { type: 'TreeUpdated'; action: ActionHash };

export interface AttachmentFile {
  hash: EntryHash;
  name: string;
  file_type: string;
  size: number;
}
