import type { Snippet } from './snippet';

export interface Segment {
  text: string;
  marked: boolean;
}

/**
 * Split a snippet into marked and unmarked runs, ready to render as text and
 * `<mark>` elements.
 *
 * `snippet()` already produced the window text and the [start, end) offsets of
 * every matched term inside it; this only turns those offsets into a flat run
 * list. Overlapping marks are dropped rather than nested — two terms sharing a
 * prefix ("budget", "budgets") both match at the same offset, and a nested
 * `<mark>` would double-highlight the overlap.
 */
export function segments(snippet: Snippet): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of snippet.marks) {
    if (start < cursor) continue;
    if (start > cursor) out.push({ text: snippet.text.slice(cursor, start), marked: false });
    out.push({ text: snippet.text.slice(start, end), marked: true });
    cursor = end;
  }
  if (cursor < snippet.text.length)
    out.push({ text: snippet.text.slice(cursor), marked: false });
  return out;
}
