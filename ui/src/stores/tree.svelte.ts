import { v4 as uuid } from 'uuid';
import type { ArkClient } from '../ark-client';
import type { Folder } from '../types';
import { liveFolders, mergeHeads } from '../tree/merge';

/**
 * Holds the merged tree. `folders` keeps tombstones because the orphan bin in
 * Task 16 needs the ids of deleted folders to find the documents still filed
 * under them; `live` is what the folder pane renders.
 */
export class TreeStore {
  folders: Folder[] = $state([]);
  loading = $state(false);

  constructor(private ark: ArkClient) {}

  get live(): Folder[] {
    return liveFolders(this.folders);
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      this.folders = mergeHeads(await this.ark.getFolderTree());
    } finally {
      this.loading = false;
    }
  }

  /** Writes the merged result, which collapses any fork on the next read. */
  private async save(folders: Folder[]): Promise<void> {
    await this.ark.updateFolderTree(folders);
    this.folders = folders;
  }

  async addFolder(name: string, parent: string | null = null): Promise<string> {
    const id = uuid();
    // Count live siblings only. Counting tombstones too would hand the new
    // folder an `order` already taken by a visible one.
    const order = this.live.filter((f) => f.parent === parent).length;
    await this.save([...this.folders, { id, name, parent, order, deleted: false }]);
    return id;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.save(this.folders.map((f) => (f.id === id ? { ...f, name } : f)));
  }

  async reparentFolder(id: string, parent: string | null): Promise<void> {
    await this.save(this.folders.map((f) => (f.id === id ? { ...f, parent } : f)));
  }

  /** Tombstone, never removal. See mergeHeads for why. */
  async deleteFolder(id: string): Promise<void> {
    await this.save(this.folders.map((f) => (f.id === id ? { ...f, deleted: true } : f)));
  }
}
