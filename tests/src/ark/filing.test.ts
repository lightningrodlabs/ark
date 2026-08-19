import { describe, expect, it } from 'vitest';
import { runScenario, dhtSync } from '@holochain-open-dev/tryorama';
import { ActionHash, encodeHashToBase64 } from '@holochain/client';
import { appSource, call, arkCell } from '../common.js';

type FolderFiling = { folder_id: string; documents: ActionHash[] };
type DocumentVersion = { body: string };

const b64 = (h: ActionHash) => encodeHashToBase64(h);

describe('filing', () => {
  it('files a document into a folder at creation', async () => {
    await runScenario(async (scenario) => {
      const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
      await scenario.shareAllAgents();

      const original = await call<ActionHash>(alice, 'create_document', {
        body: 'minutes',
        meta: { title: 'Aug', date: '2026-08-12' },
        folder_id: 'f1',
      });
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      const filings = await call<FolderFiling[]>(bob, 'get_filings', ['f1']);
      expect(filings).toHaveLength(1);
      expect(filings[0].documents.map(b64)).toEqual([b64(original)]);
    });
  });

  it('moves a document without creating a new version', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);
      const original = await call<ActionHash>(alice, 'create_document', {
        body: 'minutes',
        meta: { title: 'Aug' },
        folder_id: 'f1',
      });
      const before = await call<DocumentVersion[]>(alice, 'get_document_versions', original);

      await call(alice, 'move_document', { original, from: 'f1', to: 'f2' });

      const filings = await call<FolderFiling[]>(alice, 'get_filings', ['f1', 'f2']);
      const byId = Object.fromEntries(filings.map((f) => [f.folder_id, f.documents.map(b64)]));
      expect(byId['f1']).toEqual([]);
      expect(byId['f2']).toEqual([b64(original)]);

      const after = await call<DocumentVersion[]>(alice, 'get_document_versions', original);
      expect(after).toHaveLength(before.length);
    });
  });

  it('unfiles a document when moved to null', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);
      const original = await call<ActionHash>(alice, 'create_document', {
        body: 'minutes',
        meta: {},
        folder_id: 'f1',
      });
      await call(alice, 'move_document', { original, from: 'f1', to: null });
      const filings = await call<FolderFiling[]>(alice, 'get_filings', ['f1']);
      expect(filings[0].documents).toEqual([]);
    });
  });

  it('returns an empty filing for a folder that never existed', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);
      const filings = await call<FolderFiling[]>(alice, 'get_filings', ['ghost']);
      expect(filings).toEqual([{ folder_id: 'ghost', documents: [] }]);
    });
  });
});
