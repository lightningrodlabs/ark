import { describe, expect, it } from 'vitest';
import { runScenario, dhtSync } from '@holochain-open-dev/tryorama';
import { ActionHash, encodeHashToBase64 } from '@holochain/client';
import { appSource, call, arkCell } from '../common.js';

type FolderFiling = { folder_id: string; documents: ActionHash[] };
const b64 = (h: ActionHash) => encodeHashToBase64(h);

describe('trash', () => {
  it('trashes and restores a document, keeping its filing throughout', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);
      const original = await call<ActionHash>(alice, 'create_document', {
        body: 'minutes',
        meta: { title: 'Aug' },
        folder_id: 'f1',
      });

      await call(alice, 'trash_document', original);
      expect((await call<ActionHash[]>(alice, 'get_trashed', null)).map(b64)).toEqual([
        b64(original),
      ]);

      // Filing survives, so restore puts it back where it was.
      const filings = await call<FolderFiling[]>(alice, 'get_filings', ['f1']);
      expect(filings[0].documents.map(b64)).toEqual([b64(original)]);

      // The document is still fully readable.
      expect(await call(alice, 'get_document', original)).not.toBeNull();

      await call(alice, 'restore_document', original);
      expect(await call<ActionHash[]>(alice, 'get_trashed', null)).toEqual([]);
    });
  });

  it('restores cleanly when two agents trashed the same document', async () => {
    await runScenario(async (scenario) => {
      const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
      await scenario.shareAllAgents();

      const original = await call<ActionHash>(alice, 'create_document', {
        body: 'minutes',
        meta: {},
        folder_id: null,
      });
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      await Promise.all([
        call(alice, 'trash_document', original),
        call(bob, 'trash_document', original),
      ]);
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      // Two links, one trashed document.
      expect((await call<ActionHash[]>(alice, 'get_trashed', null)).map(b64)).toEqual([
        b64(original),
      ]);

      await call(alice, 'restore_document', original);
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);
      expect(await call<ActionHash[]>(bob, 'get_trashed', null)).toEqual([]);
    });
  });
});
