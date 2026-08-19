import { v4 as uuid } from 'uuid';
import type { ActionHash } from '@holochain/client';
import type { ArkClient } from '../ark-client';
import type { Folder } from '../types';
import { liveFolders, mergeHeads, sameFolders } from '../tree/merge';

/**
 * Holds the merged tree. `folders` keeps tombstones because the orphan bin in
 * Task 16 needs the ids of deleted folders to find the documents still filed
 * under them; `live` is what the folder pane renders.
 */
export class TreeStore {
  folders: Folder[] = $state([]);
  loading = $state(false);
  /** Root LINKS `tree_roots()` found, from the last `load()`. */
  rootCount = $state(0);
  /** How many of those roots' tips actually resolved, from the last `load()`. */
  headCount = $state(0);
  /**
   * Set by the app once the signal store exists (constructed after this
   * store, so it cannot be a constructor dependency). Called with the write's
   * action hash so every tree write broadcasts `TreeUpdated`.
   */
  onUpdate?: (action: ActionHash) => void;

  constructor(private ark: ArkClient) {}

  get live(): Folder[] {
    return liveFolders(this.folders);
  }

  /**
   * True when at least one root LINK has arrived without its `FolderTree`
   * entry — i.e. `rootCount > headCount`. Root links and entries gossip
   * independently (see `folder.rs`'s `get_folder_tree`), so this is the exact
   * signal that the tree exists and simply has not arrived on this device
   * yet, as opposed to `rootCount === 0`, which means no folder was ever
   * created. A caller must not infer this from `folders` being empty alone —
   * that is true in both cases.
   *
   * Also covers a root that forked into two writers before either had synced
   * the other (`rootCount` 2) where only one side's tip has resolved so far
   * (`headCount` 1): still a partial arrival, not a resolved tree with fewer
   * folders than it should have.
   */
  get structurePending(): boolean {
    return this.rootCount > this.headCount;
  }

  /**
   * Returns whether the merged tree actually differs from what is held.
   *
   * Like DocumentStore.load, this assigns only on a real change: `folders` is
   * a `$state` array compared by reference, so handing it an equal-but-new
   * array on every five-minute reconcile invalidated the whole folder pane
   * and every per-folder count derived from it.
   */
  async load(): Promise<boolean> {
    this.loading = true;
    try {
      const snapshot = await this.ark.getFolderTree();
      this.rootCount = snapshot.root_count;
      this.headCount = snapshot.heads.length;
      const folders = mergeHeads(snapshot.heads);
      if (sameFolders(this.folders, folders)) return false;
      this.folders = folders;
      return true;
    } finally {
      this.loading = false;
    }
  }

  /** Writes the merged result, which collapses any fork on the next read. */
  private async save(folders: Folder[]): Promise<void> {
    const action = await this.ark.updateFolderTree(folders);
    this.folders = folders;
    this.onUpdate?.(action);
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
