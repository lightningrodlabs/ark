import { describe, expect, it } from 'vitest';
import { runScenario } from '@holochain-open-dev/tryorama';
import { ActionHash, EntryHash, encodeHashToBase64 } from '@holochain/client';
import { appSource, call } from '../common.js';

const b64 = (h: EntryHash) => encodeHashToBase64(h);

/** Store a small file through the vendored file_storage zome. */
async function storeFile(player: any, name: string, bytes: Uint8Array): Promise<EntryHash> {
  const chunkHash = await player.cells
    .find((c: any) => c.name === 'ark')!
    .callZome({ zome_name: 'file_storage', fn_name: 'create_file_chunk', payload: bytes });
  return player.cells
    .find((c: any) => c.name === 'ark')!
    .callZome({
      zome_name: 'file_storage',
      fn_name: 'create_file_metadata',
      payload: {
        name,
        file_type: 'text/plain',
        size: bytes.length,
        last_modified: Date.now() * 1000, // Holochain Timestamp is microseconds
        chunks_hashes: [chunkHash],
      },
    });
}

describe('attachments', () => {
  it('attaches a file and keeps it across an amendment', async () => {
    await runScenario(async (scenario) => {
      const [alice] = await scenario.addPlayersWithApps([appSource]);

      const original = await call<ActionHash>(alice, 'create_document', {
        body: 'minutes',
        meta: { title: 'Aug' },
        folder_id: null,
      });
      const fileHash = await storeFile(alice, 'budget.csv', new TextEncoder().encode('a,b\n1,2\n'));

      await call(alice, 'attach_file', { original, file_hash: fileHash });
      expect((await call<EntryHash[]>(alice, 'get_attachments', original)).map(b64)).toEqual([
        b64(fileHash),
      ]);

      // Amending the body must not disturb attachments — they hang off the
      // original create action, not off a version.
      await call(alice, 'amend_document', { original, body: 'minutes v2', meta: {} });
      expect((await call<EntryHash[]>(alice, 'get_attachments', original)).map(b64)).toEqual([
        b64(fileHash),
      ]);

      await call(alice, 'detach_file', { original, file_hash: fileHash });
      expect(await call<EntryHash[]>(alice, 'get_attachments', original)).toEqual([]);
    });
  });
});
