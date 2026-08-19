import { describe, expect, it, vi } from 'vitest';
import type { AppClient } from '@holochain/client';
import { connectClient, type ConnectDeps } from './connect';

const weaveClient = { tag: 'weave' } as unknown as AppClient;
const websocketClient = { tag: 'websocket' } as unknown as AppClient;

function deps(over: Partial<ConnectDeps> = {}) {
  const calls: string[] = [];
  const d: ConnectDeps = {
    isDev: true,
    isWeaveContext: vi.fn(() => {
      calls.push('isWeaveContext');
      return false;
    }),
    initializeHotReload: vi.fn(async () => {
      calls.push('initializeHotReload');
    }),
    connectWeave: vi.fn(async () => {
      calls.push('connectWeave');
      return weaveClient;
    }),
    connectWebsocket: vi.fn(async () => {
      calls.push('connectWebsocket');
      return websocketClient;
    }),
    ...over,
  };
  return { d, calls };
}

describe('connectClient', () => {
  it('initialises hot reload BEFORE asking whether this is a weave context', async () => {
    // The regression this guards: checking first and initialising second means
    // Moss is never detected in `applet-dev`, so the app falls through to the
    // websocket and dies with ConnectionUrlMissing. Invisible outside Moss.
    const { d, calls } = deps();
    await connectClient(d);
    expect(calls.indexOf('initializeHotReload')).toBeLessThan(calls.indexOf('isWeaveContext'));
  });

  it('uses the weave client inside Moss', async () => {
    const { d } = deps({ isWeaveContext: () => true });
    expect(await connectClient(d)).toBe(weaveClient);
    expect(d.connectWebsocket).not.toHaveBeenCalled();
  });

  it('uses the app websocket outside Moss', async () => {
    const { d } = deps();
    expect(await connectClient(d)).toBe(websocketClient);
    expect(d.connectWeave).not.toHaveBeenCalled();
  });

  it('still detects Moss when hot reload throws', async () => {
    // initializeHotReload rejecting must not cost us the weave path — it is
    // expected to fail in some contexts and is not a signal about where we are.
    const { d } = deps({
      initializeHotReload: vi.fn(async () => {
        throw new Error('already initialised');
      }),
      isWeaveContext: () => true,
    });
    expect(await connectClient(d)).toBe(weaveClient);
  });

  it('skips hot reload entirely outside dev', async () => {
    const { d } = deps({ isDev: false, isWeaveContext: () => true });
    await connectClient(d);
    expect(d.initializeHotReload).not.toHaveBeenCalled();
  });
});
