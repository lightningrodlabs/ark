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

/** How often the backstop reconcile runs when the tab stays focused. */
export const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/** Minimum gap between reconciles, however they were triggered. */
export const RECONCILE_MIN_GAP_MS = 60 * 1000;

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
    /**
     * `source` distinguishes a focus-triggered call, which the callback is
     * expected to make cheap (skip the full reload when nothing changed),
     * from a timer-triggered one, which is the unconditional backstop — see
     * `reconcile.ts`.
     */
    private onReconcile: (source: 'focus' | 'timer') => void | Promise<void>,
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
    this.timer = setInterval(() => void this.maybeReconcile('timer'), RECONCILE_INTERVAL_MS);
  }

  stop(): void {
    this.unsubscribe?.();
    window.removeEventListener('focus', this.focusHandler);
    if (this.timer) clearInterval(this.timer);
  }

  private focusHandler = () => void this.maybeReconcile('focus');

  /**
   * A full reload (reloads the whole corpus, rebuilds the search index) is
   * seconds of work on a 1406-document archive, so `onReconcile` only pays
   * that cost when it has to — see `reconcile.ts`. Focus fires every time
   * someone switches tabs (inside Moss, every time the applet regains an
   * iframe focus event), and the timer can land moments after a focus
   * already reconciled, so both routes share one floor.
   */
  private lastReconcileAt = 0;
  private async maybeReconcile(source: 'focus' | 'timer'): Promise<void> {
    const now = Date.now();
    if (now - this.lastReconcileAt < RECONCILE_MIN_GAP_MS) return;
    this.lastReconcileAt = now;
    await this.onReconcile(source);
  }

  /**
   * No-op outside Moss, where there is no group roster to notify.
   *
   * Never throws. A signal is an optimisation — the reconcile below is what
   * guarantees peers converge — so a failed notify must not surface as a failed
   * write. Letting it propagate would tell someone their minutes did not save
   * when they did, and a retry would file the document twice.
   */
  async broadcast(signal: ArkSignal): Promise<void> {
    if (this.peers.length === 0) return;
    try {
      await this.ark.notifyPeers(this.peers, signal);
    } catch (e) {
      console.warn('ark: could not notify peers; they will catch up on reconcile', e);
    }
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
