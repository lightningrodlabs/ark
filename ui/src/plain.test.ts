import { describe, expect, it } from 'vitest';
import { toPlain } from './plain';

/**
 * A stand-in for what Svelte 5's `$state` hands back: a transparent Proxy over
 * an array or plain object. `structuredClone` refuses to clone one, which is
 * exactly how this fails inside Moss — the applet's zome call crosses an iframe
 * bridge that clones the payload.
 */
const proxied = <T extends object>(value: T): T => new Proxy(value, {});

describe('toPlain', () => {
  it('makes a proxied array structured-cloneable', () => {
    const peers = proxied([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]);
    expect(() => structuredClone(peers)).toThrow();
    expect(() => structuredClone(toPlain(peers))).not.toThrow();
  });

  it('makes a proxied object graph structured-cloneable', () => {
    const folders = proxied({
      folders: proxied([proxied({ id: 'f1', name: 'Finance', parent: null, deleted: false })]),
    });
    expect(() => structuredClone(folders)).toThrow();
    expect(() => structuredClone(toPlain(folders))).not.toThrow();
  });

  it('preserves values exactly', () => {
    const input = { a: [1, 2], b: { c: 'x' }, d: null, e: true };
    expect(toPlain(proxied(input))).toEqual(input);
  });

  it('passes hashes through by reference rather than copying them', () => {
    // Every Holochain hash is a Uint8Array, and a 1406-document load carries
    // thousands of them; rebuilding each one would be pure waste.
    const hash = new Uint8Array([9, 9, 9]);
    expect(toPlain({ original: hash }).original).toBe(hash);
  });

  it('leaves primitives, null and undefined alone', () => {
    expect(toPlain('s')).toEqual('s');
    expect(toPlain(7)).toEqual(7);
    expect(toPlain(null)).toBeNull();
    expect(toPlain(undefined)).toBeUndefined();
  });

  it('does not rebuild class instances into bare objects', () => {
    class Thing {
      constructor(public v: number) {}
    }
    const t = new Thing(1);
    expect(toPlain({ t }).t).toBe(t);
  });
});
