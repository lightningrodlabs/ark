import { describe, expect, it } from 'vitest';
import { runScenario, dhtSync } from '@holochain-open-dev/tryorama';
import { ActionHash } from '@holochain/client';
import { appSource, call, arkCell } from '../common.js';

type Folder = {
  id: string;
  name: string;
  parent: string | null;
  order: number;
  deleted: boolean;
};
type TreeHead = { action: ActionHash; timestamp: number; folders: Folder[] };
type TreeSnapshot = { root_count: number; heads: TreeHead[] };

const folder = (id: string, name: string, parent: string | null = null): Folder => ({
  id,
  name,
  parent,
  order: 0,
  deleted: false,
});

describe('folder tree', () => {
  it('starts empty and stores a tree that another agent can read', async () => {
    await runScenario(async (scenario) => {
      const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
      await scenario.shareAllAgents();

      const empty = await call<TreeSnapshot>(alice, 'get_folder_tree', null);
      expect(empty.root_count).toEqual(0);
      expect(empty.heads).toHaveLength(0);

      await call(alice, 'update_folder_tree', {
        folders: [folder('f1', 'Budget and Records'), folder('f2', '2015-2019', 'f1')],
      });
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      const snapshot = await call<TreeSnapshot>(bob, 'get_folder_tree', null);
      // The tree resolves: one root link, and that root's tip resolves too —
      // root_count and heads.length agree, which is what tells the UI the
      // structure has fully arrived rather than merely partly.
      expect(snapshot.root_count).toEqual(1);
      expect(snapshot.heads).toHaveLength(1);
      expect(snapshot.heads[0].folders.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
      expect(snapshot.heads[0].folders.find((f) => f.id === 'f2')!.parent).toEqual('f1');
    });
  });

  // The DNA fix for the "node has documents but not the folder structure"
  // load-phase gap (see the UI's TreeStore.structurePending) hinges on
  // root_count and heads.length disagreeing — a root link resolved locally
  // while its FolderTree entry has not. Root links and entries are separate
  // DHT ops that gossip independently in production, but every sync helper
  // this suite has (`dhtSync`, `shareAllAgents`) waits for conductors'
  // *entire* integrated op sets to converge — there is no way to stage "link
  // arrived, entry did not" through the ordinary API and the provided sync
  // primitives, only full convergence or no sync at all. Producing that state
  // would need either a test-only extern that writes a raw, targetless link
  // (which would ship in the production wasm) or a gossip-pausing control
  // tryorama does not expose. Per the brief, this case is instead covered at
  // the store level: TreeStore's unit tests in
  // ui/src/stores/tree.test.ts construct `{ root_count: 1, heads: [] }`
  // directly, since ArkClient.getFolderTree's return value is the only thing
  // that actually needs to carry the ambiguity — everything above it (the
  // store, the banner, the Unfiled suppression) is plain data-flow from there.
  it('two roots created before either agent has synced both resolve once they do', async () => {
    await runScenario(async (scenario) => {
      const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
      await scenario.shareAllAgents();

      // Neither has seen a root yet, so each write is `tips.is_empty()`
      // locally and creates its OWN root — the "two agents initialising at
      // the same moment" case tree_roots()'s doc comment describes.
      await Promise.all([
        call(alice, 'update_folder_tree', { folders: [folder('a1', 'Alice root')] }),
        call(bob, 'update_folder_tree', { folders: [folder('b1', 'Bob root')] }),
      ]);
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      const snapshot = await call<TreeSnapshot>(alice, 'get_folder_tree', null);
      expect(snapshot.root_count).toEqual(2);
      expect(snapshot.heads).toHaveLength(2);
      const ids = new Set(snapshot.heads.flatMap((h) => h.folders.map((f) => f.id)));
      expect(ids.has('a1')).toBe(true);
      expect(ids.has('b1')).toBe(true);
    });
  });

  it('keeps one head when edits are sequential', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);
      await call(alice, 'update_folder_tree', { folders: [folder('f1', 'One')] });
      await call(alice, 'update_folder_tree', {
        folders: [folder('f1', 'One renamed'), folder('f2', 'Two')],
      });
      const snapshot = await call<TreeSnapshot>(alice, 'get_folder_tree', null);
      expect(snapshot.root_count).toEqual(1);
      expect(snapshot.heads).toHaveLength(1);
      expect(snapshot.heads[0].folders).toHaveLength(2);
    });
  });

  // NOTE: there is deliberately no integration test asserting `heads.length >= 2`.
  // Forking the update chain requires two writes to race gossip, which tryorama
  // cannot stage — and authoring before `shareAllAgents()` can leave a write
  // permanently unsynced rather than merely late. The "return every tip, never
  // one winner" property is guarded by `all_tips` itself and by the UI's
  // mergeHeads unit tests in Task 10, which feed it multi-head input directly.

  it('loses no folder when two agents edit the same tree concurrently', async () => {
    await runScenario(async (scenario) => {
      const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
      await scenario.shareAllAgents();

      await call(alice, 'update_folder_tree', { folders: [folder('f1', 'Base')] });
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      await Promise.all([
        call(alice, 'update_folder_tree', {
          folders: [folder('f1', 'Base'), folder('a1', 'Alice folder')],
        }),
        call(bob, 'update_folder_tree', {
          folders: [folder('f1', 'Base'), folder('b1', 'Bob folder')],
        }),
      ]);
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      // Asserts the property, not the mechanism. Whether these two writes fork
      // the chain or gossip linearises them is outside the test's control, and
      // both callers are sending a full list that predates the other's write.
      // Neither folder may be lost either way — which holds because
      // update_folder_tree carries forward ids the caller did not send.
      const snapshot = await call<TreeSnapshot>(alice, 'get_folder_tree', null);
      const ids = new Set(snapshot.heads.flatMap((h) => h.folders.map((f) => f.id)));
      expect(ids.has('a1')).toBe(true);
      expect(ids.has('b1')).toBe(true);
    });
  });

  it('keeps a tombstone through carry-forward rather than resurrecting the folder', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);

      await call(alice, 'update_folder_tree', {
        folders: [folder('f1', 'Doomed'), folder('f2', 'Keeper')],
      });

      // Caller sends f1 tombstoned and omits f2 entirely. f2 must be carried
      // forward, and f1 must stay deleted — carry-forward must not resurrect a
      // folder the caller deliberately tombstoned.
      await call(alice, 'update_folder_tree', {
        folders: [{ ...folder('f1', 'Doomed'), deleted: true }],
      });

      const snapshot = await call<TreeSnapshot>(alice, 'get_folder_tree', null);
      const byId = Object.fromEntries(
        snapshot.heads.flatMap((h) => h.folders).map((f) => [f.id, f]),
      );
      expect(byId['f1'].deleted).toBe(true);
      expect(byId['f2']).toBeDefined();
      expect(byId['f2'].deleted).toBe(false);
    });
  });

  it('rejects duplicate folder ids', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);
      await expect(
        call(alice, 'update_folder_tree', {
          folders: [folder('dup', 'One'), folder('dup', 'Two')],
        }),
      ).rejects.toThrow();
    });
  });
});
