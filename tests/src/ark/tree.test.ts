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

      expect(await call<TreeHead[]>(alice, 'get_folder_tree', null)).toHaveLength(0);

      await call(alice, 'update_folder_tree', {
        folders: [folder('f1', 'Budget and Records'), folder('f2', '2015-2019', 'f1')],
      });
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      const heads = await call<TreeHead[]>(bob, 'get_folder_tree', null);
      expect(heads).toHaveLength(1);
      expect(heads[0].folders.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
      expect(heads[0].folders.find((f) => f.id === 'f2')!.parent).toEqual('f1');
    });
  });

  it('keeps one head when edits are sequential', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);
      await call(alice, 'update_folder_tree', { folders: [folder('f1', 'One')] });
      await call(alice, 'update_folder_tree', {
        folders: [folder('f1', 'One renamed'), folder('f2', 'Two')],
      });
      const heads = await call<TreeHead[]>(alice, 'get_folder_tree', null);
      expect(heads).toHaveLength(1);
      expect(heads[0].folders).toHaveLength(2);
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
      const heads = await call<TreeHead[]>(alice, 'get_folder_tree', null);
      const ids = new Set(heads.flatMap((h) => h.folders.map((f) => f.id)));
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

      const heads = await call<TreeHead[]>(alice, 'get_folder_tree', null);
      const byId = Object.fromEntries(heads.flatMap((h) => h.folders).map((f) => [f.id, f]));
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
