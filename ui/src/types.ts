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

export interface DocumentSummary {
  original: ActionHash;
  latest: ActionHash;
  author: AgentPubKey;
  created_at: number;
  updated_at: number;
  body: string;
  meta: Meta;
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
