import type { AppClient } from '@holochain/client';

/**
 * Everything `connectClient` touches, injected so the ordering below can be
 * tested. The ordering is the whole point of this module: getting it wrong
 * produces `ConnectionUrlMissing` inside Moss and is invisible outside it.
 */
export interface ConnectDeps {
  isDev: boolean;
  isWeaveContext: () => boolean;
  initializeHotReload: () => Promise<void>;
  connectWeave: () => Promise<AppClient>;
  connectWebsocket: () => Promise<AppClient>;
}

/**
 * Decide how to reach the conductor.
 *
 * `initializeHotReload()` MUST run before `isWeaveContext()` is consulted. In
 * `applet-dev` the applet is served by vite and loaded into a Moss iframe, and
 * that handshake is what makes `isWeaveContext()` report true. Checking first
 * and initialising second means Moss is never detected, so the code falls
 * through to `AppWebsocket.connect()` and dies with
 * `ConnectionUrlMissing: unable to connect to Conductor API` — a failure that
 * only appears inside Moss, and only in dev.
 *
 * `../../emergence` and `../../presence-0.7` both initialise first; this
 * matches them.
 */
export async function connectClient(deps: ConnectDeps): Promise<AppClient> {
  if (deps.isDev) {
    try {
      await deps.initializeHotReload();
    } catch {
      // Only works inside Moss. Outside it this is expected to fail, and the
      // websocket path below is the right answer.
    }
  }

  return deps.isWeaveContext() ? deps.connectWeave() : deps.connectWebsocket();
}
