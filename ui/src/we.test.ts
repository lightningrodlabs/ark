import { describe, expect, it, vi } from 'vitest';
import type { AppClient } from '@holochain/client';
import { appletServices } from './we';
import type { DocumentSummary } from './types';

const original = new Uint8Array([1, 2, 3]);

function clientReturning(doc: DocumentSummary | null): AppClient {
  return {
    callZome: vi.fn(async () => doc),
  } as unknown as AppClient;
}

const doc: DocumentSummary = {
  original,
  latest: original,
  author: new Uint8Array([9]),
  created_at: 0,
  updated_at: 0,
  body: '# Minutes\n\nApproved.',
  meta: { title: 'Board Minutes', date: '2026-01-15' },
};

describe('getAssetInfo', () => {
  it('names the asset from the document title for the plain WAL', async () => {
    const info = await appletServices.getAssetInfo!(clientReturning(doc), {
      hrl: [new Uint8Array(), original],
      context: {},
    });
    expect(info).toEqual({ name: 'Board Minutes', icon_src: expect.stringContaining('data:image/svg+xml') });
  });

  it('still resolves a pocket item saved with the old "rendered" context', async () => {
    // That second view was removed: it rendered through the same AssetView and
    // was indistinguishable from the plain one once opened. Items already in
    // someone's pocket still carry the context, and breaking them would be a
    // worse outcome than the duplication ever was.
    const plain = await appletServices.getAssetInfo!(clientReturning(doc), {
      hrl: [new Uint8Array(), original],
      context: {},
    });
    const legacy = await appletServices.getAssetInfo!(clientReturning(doc), {
      hrl: [new Uint8Array(), original],
      context: { view: 'rendered' },
    });
    expect(legacy).toEqual(plain);
  });

  it('returns undefined, not an error, for a document that no longer resolves', async () => {
    const info = await appletServices.getAssetInfo!(clientReturning(null), {
      hrl: [new Uint8Array(), original],
      context: {},
    });
    expect(info).toBeUndefined();
  });

  it('returns undefined if the zome call itself throws', async () => {
    const client = {
      callZome: vi.fn(async () => {
        throw new Error('cell not found');
      }),
    } as unknown as AppClient;
    const info = await appletServices.getAssetInfo!(client, {
      hrl: [new Uint8Array(), original],
      context: {},
    });
    expect(info).toBeUndefined();
  });
});
