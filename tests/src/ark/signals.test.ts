import { describe, expect, it } from 'vitest';
import { runScenario, dhtSync } from '@holochain-open-dev/tryorama';
import { ActionHash, encodeHashToBase64 } from '@holochain/client';
import { appSource, call, arkCell, collectSignals, untilSignal } from '../common.js';

describe('remote signals', () => {
  it('delivers a DocumentCreated signal to a named peer', async () => {
    await runScenario(async (scenario) => {
      const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
      await scenario.shareAllAgents();

      const bobSignals = collectSignals(bob);

      const original = await call<ActionHash>(alice, 'create_document', {
        body: 'minutes',
        meta: { title: 'Aug' },
        folder_id: null,
      });
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      await call(alice, 'notify_peers', {
        peers: [bob.agentPubKey],
        signal: { type: 'DocumentCreated', original },
      });

      const hit = await untilSignal(bobSignals, (s: any) => s?.type === 'DocumentCreated');
      expect(encodeHashToBase64(hit.original)).toEqual(encodeHashToBase64(original));
    });
  });

  it('delivers a TreeUpdated signal', async () => {
    await runScenario(async (scenario) => {
      const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
      await scenario.shareAllAgents();

      const bobSignals = collectSignals(bob);
      const action = await call<ActionHash>(alice, 'update_folder_tree', {
        folders: [{ id: 'f1', name: 'One', parent: null, order: 0, deleted: false }],
      });
      await call(alice, 'notify_peers', {
        peers: [bob.agentPubKey],
        signal: { type: 'TreeUpdated', action },
      });

      const hit = await untilSignal(bobSignals, (s: any) => s?.type === 'TreeUpdated');
      expect(encodeHashToBase64(hit.action)).toEqual(encodeHashToBase64(action));
    });
  });
});
