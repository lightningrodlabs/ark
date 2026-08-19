import type { ActionHash } from '@holochain/client';
import type { DocumentSummary } from '../types';

/**
 * Byte-wise hash comparison. Cheaper than encoding to base64 on both sides,
 * and these run once per document on every reconcile.
 */
export function sameHash(a: ActionHash, b: ActionHash): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Whether two document maps hold the same archive: the same keys, each at the
 * same version.
 *
 * `latest` is the action hash of a document's newest version, so comparing it
 * catches an amendment as well as an add or a removal — which is exactly the
 * set of changes a reload can discover. Bodies are not compared: a differing
 * body with an identical `latest` would mean two different entries under one
 * action hash, which the DHT cannot produce.
 */
export function sameDocuments(
  a: Map<string, DocumentSummary>,
  b: Map<string, DocumentSummary>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, doc] of a) {
    const other = b.get(k);
    if (!other) return false;
    if (!sameHash(doc.latest, other.latest)) return false;
  }
  return true;
}

/** Whether two filing maps agree on every document's folder. */
export function sameFilings(
  a: Map<string, string | null>,
  b: Map<string, string | null>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, folder] of a) {
    if (!b.has(k)) return false;
    if (b.get(k) !== folder) return false;
  }
  return true;
}

/** Whether two key sets hold the same members. */
export function sameKeys(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}
