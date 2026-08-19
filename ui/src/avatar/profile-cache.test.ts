import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cachedAgentProfile, clearProfileCache } from './profile-cache';

const agent = (n: number) => new Uint8Array([n, n, n]) as any;

function fakeClient(entry: unknown) {
  return { getAgentProfile: vi.fn(async () => ({ entry })) };
}

beforeEach(() => clearProfileCache());

describe('cachedAgentProfile', () => {
  it('fetches once and reuses the result across separate calls (and instances)', async () => {
    const client = fakeClient({ nickname: 'Alex', fields: {} });
    const a = await cachedAgentProfile(client as any, agent(1));
    const b = await cachedAgentProfile(client as any, agent(1));

    expect(a).toEqual({ nickname: 'Alex', fields: {} });
    expect(b).toEqual({ nickname: 'Alex', fields: {} });
    expect(client.getAgentProfile).toHaveBeenCalledOnce();
  });

  it('fetches separately per distinct agent key', async () => {
    const client = fakeClient({ nickname: 'Alex', fields: {} });
    await cachedAgentProfile(client as any, agent(1));
    await cachedAgentProfile(client as any, agent(2));

    expect(client.getAgentProfile).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent in-flight calls for the same agent to one request', async () => {
    let resolve!: (v: unknown) => void;
    const client = {
      getAgentProfile: vi.fn(
        () => new Promise((r) => { resolve = r; }),
      ),
    };
    const p1 = cachedAgentProfile(client as any, agent(1));
    const p2 = cachedAgentProfile(client as any, agent(1));
    resolve({ entry: { nickname: 'Alex', fields: {} } });

    await Promise.all([p1, p2]);
    expect(client.getAgentProfile).toHaveBeenCalledOnce();
  });

  it('caches "no profile" (record present but no entry) as undefined', async () => {
    const client = { getAgentProfile: vi.fn(async () => undefined) };
    const a = await cachedAgentProfile(client as any, agent(1));
    const b = await cachedAgentProfile(client as any, agent(1));

    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    expect(client.getAgentProfile).toHaveBeenCalledOnce();
  });

  it('does not cache a failed fetch, so a later call retries instead of being stuck as "no profile" forever', async () => {
    const client = {
      getAgentProfile: vi
        .fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ entry: { nickname: 'Alex', fields: {} } }),
    };
    const first = await cachedAgentProfile(client as any, agent(1));
    expect(first).toBeUndefined();

    const second = await cachedAgentProfile(client as any, agent(1));
    expect(second).toEqual({ nickname: 'Alex', fields: {} });
    expect(client.getAgentProfile).toHaveBeenCalledTimes(2);
  });
});
