import { describe, expect, it } from 'vitest';
import { runScenario, dhtSync } from '@holochain-open-dev/tryorama';
import { ActionHash, encodeHashToBase64 } from '@holochain/client';
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
type DocumentVersion = {
  action: ActionHash;
  author: Uint8Array;
  timestamp: number;
  body: string;
  meta: Record<string, string>;
};

const doc = (title: string, body: string) => ({ body, meta: { title }, folder_id: null });

describe('amendments', () => {
  it('lets a different agent amend, and both agents see the same latest', async () => {
    await runScenario(async (scenario) => {
      const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
      await scenario.shareAllAgents();

      const original = await call<ActionHash>(alice, 'create_document', doc('Minutes', 'first'));
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      await call(bob, 'amend_document', { original, body: 'second', meta: { title: 'Minutes' } });
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      const fromAlice = await call<DocumentSummary | null>(alice, 'get_document', original);
      const fromBob = await call<DocumentSummary | null>(bob, 'get_document', original);
      expect(fromAlice!.body).toEqual('second');
      expect(fromBob!.body).toEqual('second');
      expect(encodeHashToBase64(fromAlice!.latest)).toEqual(encodeHashToBase64(fromBob!.latest));
      expect(encodeHashToBase64(fromAlice!.original)).toEqual(encodeHashToBase64(original));
      expect(fromAlice!.created_at).toBeLessThanOrEqual(fromAlice!.updated_at);
    });
  });

  it('returns every version oldest first', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);
      const original = await call<ActionHash>(alice, 'create_document', doc('Minutes', 'v1'));
      await call(alice, 'amend_document', { original, body: 'v2', meta: { title: 'Minutes' } });
      await call(alice, 'amend_document', { original, body: 'v3', meta: { title: 'Minutes' } });

      const versions = await call<DocumentVersion[]>(alice, 'get_document_versions', original);
      expect(versions.map((v) => v.body)).toEqual(['v1', 'v2', 'v3']);
    });
  });

  it('resolves concurrent amendments to the same latest on both agents', async () => {
    await runScenario(async (scenario) => {
      const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
      await scenario.shareAllAgents();

      const original = await call<ActionHash>(alice, 'create_document', doc('Minutes', 'base'));
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      // Both amend the same original before either sees the other's write.
      await Promise.all([
        call(alice, 'amend_document', { original, body: 'alice edit', meta: {} }),
        call(bob, 'amend_document', { original, body: 'bob edit', meta: {} }),
      ]);
      await dhtSync([alice, bob], arkCell(alice).cell_id[0]);

      const fromAlice = await call<DocumentSummary | null>(alice, 'get_document', original);
      const fromBob = await call<DocumentSummary | null>(bob, 'get_document', original);
      expect(encodeHashToBase64(fromAlice!.latest)).toEqual(encodeHashToBase64(fromBob!.latest));
      expect(fromAlice!.body).toEqual(fromBob!.body);

      // Neither edit is lost — both are in the version list.
      const versions = await call<DocumentVersion[]>(alice, 'get_document_versions', original);
      const bodies = versions.map((v) => v.body);
      expect(bodies).toContain('alice edit');
      expect(bodies).toContain('bob edit');
    });
  });
});
