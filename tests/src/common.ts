import { PlayerApp } from '@holochain-open-dev/tryorama';
import { AppBundleSource, SignalType } from '@holochain/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const HAPP_PATH = path.resolve(__dirname, '../../workdir/ark.happ');
export const appBundleSource: AppBundleSource = { type: 'path', value: HAPP_PATH };
export const appSource = { appBundleSource };
export const ROLE_NAME = 'ark';
export const ZOME_NAME = 'ark';

export function arkCell(player: PlayerApp) {
  const cell = player.cells.find((c) => c.name === ROLE_NAME);
  if (!cell) throw new Error(`No cell with role name ${ROLE_NAME}`);
  return cell;
}

export const call = <T>(player: PlayerApp, fn_name: string, payload: unknown): Promise<T> =>
  arkCell(player).callZome({ zome_name: ZOME_NAME, fn_name, payload }) as Promise<T>;

/** Collect app-signal payloads for a player. */
export function collectSignals(player: PlayerApp): unknown[] {
  const signals: unknown[] = [];
  player.appWs.on('signal', (signal) => {
    if (signal.type === SignalType.App) signals.push(signal.value.payload);
  });
  return signals;
}

export async function untilSignal(
  signals: unknown[],
  predicate: (s: any) => boolean,
  timeoutMs = 20_000,
): Promise<any> {
  const start = Date.now();
  for (;;) {
    const hit = signals.find(predicate);
    if (hit) return hit;
    if (Date.now() - start > timeoutMs)
      throw new Error(`Timed out after ${timeoutMs}ms waiting for signal`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
