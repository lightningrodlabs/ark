import {
  SignalType,
  encodeHashToBase64,
  type AgentPubKey,
  type AppClient,
} from '@holochain/client';
import type { WeaveClient } from '@theweave/api';
import type { ArkClient } from '../ark-client';
import type { ArkSignal } from '../types';

export function peersExcludingSelf(all: AgentPubKey[], me: AgentPubKey): AgentPubKey[] {
  const mine = encodeHashToBase64(me);
  return all.filter((peer) => encodeHashToBase64(peer) !== mine);
}

export function needsReconcile(
  local: Set<string>,
  remote: Set<string>,
): { added: string[]; removed: string[] } {
  return {
    added: [...remote].filter((id) => !local.has(id)),
    removed: [...local].filter((id) => !remote.has(id)),
  };
}

/** How often the backstop reconcile runs when the tab stays focused. */
export const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Remote signals are best-effort: a peer that was offline, or a signal that was
 * dropped, must not leave the view permanently wrong. The store therefore also
 * reconciles on window focus and on a timer.
 */
export class SignalStore {
  peers: AgentPubKey[] = $state([]);
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private client: AppClient,
    private ark: ArkClient,
    private onSignal: (signal: ArkSignal) => void | Promise<void>,
    private onReconcile: () => void | Promise<void>,
  ) {}

  start(): void {
    this.unsubscribe = this.client.on('signal', (signal) => {
      if (signal.type !== SignalType.App) return;
      const payload = signal.value.payload as ArkSignal;
      if (payload && typeof payload === 'object' && 'type' in payload) {
        void this.onSignal(payload);
      }
    });
    window.addEventListener('focus', this.focusHandler);
    this.timer = setInterval(() => void this.onReconcile(), RECONCILE_INTERVAL_MS);
  }

  stop(): void {
    this.unsubscribe?.();
    window.removeEventListener('focus', this.focusHandler);
    if (this.timer) clearInterval(this.timer);
  }

  private focusHandler = () => void this.onReconcile();

  /** No-op outside Moss, where there is no group roster to notify. */
  async broadcast(signal: ArkSignal): Promise<void> {
    if (this.peers.length === 0) return;
    await this.ark.notifyPeers(this.peers, signal);
  }

  /**
   * The roster comes from Moss: appletParticipants() is every agent who has
   * this applet installed in the group. Outside Moss (hc-spin dev) there is no
   * weave client, the roster stays empty, and broadcast() is a no-op.
   */
  async refreshPeers(weaveClient: WeaveClient | undefined, me: AgentPubKey): Promise<void> {
    if (!weaveClient) {
      this.peers = [];
      return;
    }
    const participants = (await weaveClient.appletParticipants()) as AgentPubKey[];
    this.peers = peersExcludingSelf(participants, me);
  }
}
