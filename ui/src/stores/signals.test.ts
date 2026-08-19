import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FULL_SWEEP_EVERY,
  RECONCILE_INTERVAL_MS,
  SignalStore,
  peersExcludingSelf,
} from './signals.svelte';
import type { ReconcileSource } from '../reconcile';

const key = (n: number) => new Uint8Array([n, n, n]) as any;

describe('peersExcludingSelf', () => {
  it('drops the local agent', () => {
    const all = [key(1), key(2), key(3)];
    expect(peersExcludingSelf(all, key(2))).toHaveLength(2);
  });

  it('returns everyone when the local agent is not in the list', () => {
    expect(peersExcludingSelf([key(1)], key(9))).toHaveLength(1);
  });

  it('handles an empty roster', () => {
    expect(peersExcludingSelf([], key(1))).toEqual([]);
  });
});

describe('SignalStore reconcile cadence', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function start() {
    vi.useFakeTimers();
    const sources: ReconcileSource[] = [];
    const client = { myPubKey: key(1), on: () => () => {} } as any;
    const store = new SignalStore(client, {} as any, () => {}, (source) => {
      sources.push(source);
    });
    store.start();
    return { store, sources };
  }

  // The five-minute tick used to be the unconditional full reload, which is
  // what repainted the whole screen every five minutes. It is now an ordinary
  // cheap-check tick, and only every sixth one — half an hour — pays for the
  // unconditional pass that catches a missed amendment.
  it('sends an ordinary timer source on most ticks', () => {
    const { store, sources } = start();
    for (let i = 0; i < FULL_SWEEP_EVERY - 1; i++) vi.advanceTimersByTime(RECONCILE_INTERVAL_MS);
    expect(sources).toEqual(Array(FULL_SWEEP_EVERY - 1).fill('timer'));
    store.stop();
  });

  it('sends a sweep on every FULL_SWEEP_EVERY-th tick', () => {
    const { store, sources } = start();
    for (let i = 0; i < FULL_SWEEP_EVERY * 2; i++) vi.advanceTimersByTime(RECONCILE_INTERVAL_MS);

    expect(sources).toHaveLength(FULL_SWEEP_EVERY * 2);
    expect(sources.filter((s) => s === 'sweep')).toHaveLength(2);
    expect(sources[FULL_SWEEP_EVERY - 1]).toBe('sweep');
    expect(sources[FULL_SWEEP_EVERY * 2 - 1]).toBe('sweep');
    store.stop();
  });

  it('stops ticking after stop()', () => {
    const { store, sources } = start();
    store.stop();
    vi.advanceTimersByTime(RECONCILE_INTERVAL_MS * 3);
    expect(sources).toEqual([]);
  });
});
