/**
 * Strip reactive proxies out of a value before it crosses a structured-clone
 * boundary.
 *
 * Svelte 5's `$state` wraps arrays and plain objects in Proxies. Moss delivers
 * zome calls to an applet over an iframe bridge that structured-clones the
 * payload, and a Proxy cannot be cloned — it fails with
 * "DataCloneError: [object Array] could not be cloned", reported at the zome
 * call rather than anywhere near the store that created the value. Outside Moss
 * (hc-spin) the same payload works, so this only ever breaks in the environment
 * the tool actually ships to.
 *
 * Typed arrays — which is every Holochain hash — pass through by reference, as
 * do primitives and class instances. Only Arrays, plain objects, Maps and Sets
 * are rebuilt, because those are exactly what `$state` proxies.
 */
export function toPlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;

  // Hashes and binary payloads: cloneable as they are, and copying them would
  // be wasteful on a 1406-document load.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (value instanceof Date) return value;

  if (Array.isArray(value)) return value.map((v) => toPlain(v)) as unknown as T;
  if (value instanceof Map) {
    return new Map([...value].map(([k, v]) => [toPlain(k), toPlain(v)])) as unknown as T;
  }
  if (value instanceof Set) return new Set([...value].map((v) => toPlain(v))) as unknown as T;

  // Anything with its own prototype is a class instance the caller chose to
  // pass; rebuilding it as a bare object would change its meaning.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toPlain(v);
  return out as T;
}
