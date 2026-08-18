import { describe, expect, it } from 'vitest';
import { runScenario, dhtSync } from '@holochain-open-dev/tryorama';
import { ActionHash } from '@holochain/client';
import { appSource, call, arkCell } from '../common.js';

type DocumentSummary = {
  original: ActionHash;
  latest: ActionHash;
  author: Uint8Array;
  created_at: number;
  updated_at: number;
  body: string;
  meta: Record<string, string>;
};

const doc = (title: string, body = '## Attendance\nAlice, Bob') => ({
  body,
  meta: { title, date: '2026-08-12' },
  folder_id: null,
});

describe('documents', () => {
  it('creates a document and reads it back on another agent', async () => {
    await runScenario(async (scenario) => {
      const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
      await scenario.shareAllAgents();

      const original = await call<ActionHash>(alice, 'create_document', doc('Finance and Legal'));
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      const read = await call<DocumentSummary | null>(bob, 'get_document', original);
      expect(read).not.toBeNull();
      expect(read!.meta.title).toEqual('Finance and Legal');
      expect(read!.body).toContain('Attendance');
      expect(read!.latest).toEqual(read!.original);
    });
  });

  it('lists all documents with offset and limit', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);

      for (let i = 0; i < 5; i++) await call(alice, 'create_document', doc(`Doc ${i}`));

      const all = await call<DocumentSummary[]>(alice, 'get_all_documents', {
        offset: 0,
        limit: 100,
      });
      expect(all).toHaveLength(5);

      const page = await call<DocumentSummary[]>(alice, 'get_all_documents', {
        offset: 2,
        limit: 2,
      });
      expect(page).toHaveLength(2);
    });
  });

  it('rejects a body over 1 MiB', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);
      const huge = 'x'.repeat(1024 * 1024 + 1);
      await expect(call(alice, 'create_document', doc('Too big', huge))).rejects.toThrow();
    });
  });

  it('rejects an empty metadata key', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);
      await expect(
        call(alice, 'create_document', { body: 'hi', meta: { '': 'x' }, folder_id: null }),
      ).rejects.toThrow();
    });
  });
});
