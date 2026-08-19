import { describe, expect, it, vi } from 'vitest';
import { ArkClient } from './ark-client';
import type { AppClient } from '@holochain/client';

function fakeClient() {
  const calls: any[] = [];
  const client = {
    callZome: vi.fn(async (req: any) => {
      calls.push(req);
      return [];
    }),
  } as unknown as AppClient;
  return { client, calls };
}

describe('ArkClient', () => {
  it('sends snake_case payloads with the ark role and zome', async () => {
    const { client, calls } = fakeClient();
    const ark = new ArkClient(client);

    await ark.createDocument({ body: 'hi', meta: { title: 'T' }, folder_id: 'f1' });

    expect(calls[0].role_name).toEqual('ark');
    expect(calls[0].zome_name).toEqual('ark');
    expect(calls[0].fn_name).toEqual('create_document');
    expect(calls[0].payload).toEqual({ body: 'hi', meta: { title: 'T' }, folder_id: 'f1' });
  });

  it('pages getAllDocuments with offset and limit', async () => {
    const { client, calls } = fakeClient();
    const ark = new ArkClient(client);
    await ark.getAllDocuments(200, 100);
    expect(calls[0].fn_name).toEqual('get_all_documents');
    expect(calls[0].payload).toEqual({ offset: 200, limit: 100 });
  });

  it('passes null rather than undefined for a no-argument extern', async () => {
    const { client, calls } = fakeClient();
    const ark = new ArkClient(client);
    await ark.getFolderTree();
    expect(calls[0].payload).toBeNull();
  });

  it('wraps every extern the DNA exposes', async () => {
    const { client } = fakeClient();
    const ark = new ArkClient(client);
    // The DNA's extern list. A method missing here is a gap ten later tasks
    // would each rediscover.
    const externs = [
      'createDocument', 'getDocument', 'getAllDocuments', 'amendDocument',
      'getDocumentVersions', 'moveDocument', 'getFilings', 'getFolderTree',
      'updateFolderTree', 'trashDocument', 'restoreDocument', 'getTrashed',
      'attachFile', 'detachFile', 'getAttachments', 'notifyPeers', 'whoami',
    ];
    for (const name of externs) {
      expect(typeof (ark as any)[name], name).toEqual('function');
    }
  });
});
