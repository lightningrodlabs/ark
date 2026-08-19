import { describe, expect, it } from 'vitest';
import { peersExcludingSelf } from './signals.svelte';

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
