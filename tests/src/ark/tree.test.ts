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
        folders: [folder('f1', 'Finance and Legal'), folder('f2', '2015-2019', 'f1')],
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

  it('exposes both heads when two agents edit concurrently', async () => {
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

      const heads = await call<TreeHead[]>(alice, 'get_folder_tree', null);
      // Both forks must be returned. Collapsing to a single winner here would
      // silently drop one agent's folder — get_folder_tree returns every tip.
      expect(heads.length).toBeGreaterThanOrEqual(2);
      const ids = new Set(heads.flatMap((h) => h.folders.map((f) => f.id)));
      expect(ids.has('a1')).toBe(true);
      expect(ids.has('b1')).toBe(true);
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
