import { describe, expect, it } from 'vitest';
import { needsReconcile, peersExcludingSelf } from './signals.svelte';

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

describe('needsReconcile', () => {
  it('reports documents that appeared remotely', () => {
    expect(needsReconcile(new Set(['a']), new Set(['a', 'b']))).toEqual({
      added: ['b'],
      removed: [],
    });
  });

  it('reports documents that vanished locally', () => {
    expect(needsReconcile(new Set(['a', 'b']), new Set(['a']))).toEqual({
      added: [],
      removed: ['b'],
    });
  });

  it('reports nothing when the sets agree', () => {
    expect(needsReconcile(new Set(['a']), new Set(['a']))).toEqual({ added: [], removed: [] });
  });
});
