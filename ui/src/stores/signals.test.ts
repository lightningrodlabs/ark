import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FULL_SWEEP_EVERY,
  RECONCILE_INTERVAL_MS,
  SignalStore,
  peersExcludingSelf,
} from './signals.svelte';
import type { ReconcileOutcome, ReconcileSource } from '../reconcile';

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

  function start(outcome?: () => ReconcileOutcome | void) {
    vi.useFakeTimers();
    const sources: ReconcileSource[] = [];
    const client = { myPubKey: key(1), on: () => () => {} } as any;
    const store = new SignalStore(client, {} as any, () => {}, (source) => {
      sources.push(source);
      return outcome?.();
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

  // The sweep is the ONLY pass that catches an amendment made by a peer whose
  // signal was dropped — nothing cheaper can see one. So a tick that did no
  // work (the callback reported `skipped`, because an import is running) must
  // not spend the sweep's turn: if it did, the unconditional pass would be
  // silently missed and the next one would be half an hour away.
  it('does not let a skipped tick consume the sweep', async () => {
    let busy = false;
    const { store, sources } = start(() => (busy ? 'skipped' : 'changed'));

    // Five ordinary ticks: the sixth is due to be the sweep.
    for (let i = 0; i < FULL_SWEEP_EVERY - 1; i++) {
      await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);
    }
    expect(sources).toEqual(Array(FULL_SWEEP_EVERY - 1).fill('timer'));

    // Now an import starts. The next three ticks each ask for the sweep and
    // each is skipped without touching the cell.
    busy = true;
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);
    expect(sources.slice(FULL_SWEEP_EVERY - 1)).toEqual(['sweep', 'sweep', 'sweep']);

    // The import finishes; the sweep is still owed, and the very next tick is
    // the one that pays it rather than another five ordinary ticks first.
    busy = false;
    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);
    expect(sources[sources.length - 1]).toBe('sweep');

    // And the schedule resumes from there: ordinary ticks again.
    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);
    expect(sources[sources.length - 1]).toBe('timer');
    store.stop();
  });

  // The same reasoning one level down: a skipped tick never reached the cell,
  // so it must not start the min-gap clock either. Otherwise the first focus
  // after an import finishes would be held off for a minute by a tick that
  // did nothing.
  it('does not start the min-gap clock on a skipped tick', async () => {
    let busy = true;
    const { store, sources } = start(() => (busy ? 'skipped' : 'changed'));

    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);
    expect(sources).toEqual(['timer']);

    busy = false;
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(sources).toEqual(['timer', 'focus']);
    store.stop();
  });
});
