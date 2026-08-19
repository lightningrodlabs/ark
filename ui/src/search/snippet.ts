export interface Snippet {
  text: string;
  /** [start, end) offsets into `text` for every matched term occurrence. */
  marks: [number, number][];
}

/**
 * Keyword in context: a window around the first matched term, with every
 * occurrence of every term marked. Terms match by prefix, matching the index's
 * prefix search, so "treasur" highlights "treasurer".
 */
export function snippet(text: string, terms: string[], radius = 120): Snippet {
  const lower = text.toLowerCase();
  const cleaned = terms.map((t) => t.toLowerCase()).filter(Boolean);

  let first = -1;
  for (const term of cleaned) {
    const at = lower.indexOf(term);
    if (at >= 0 && (first === -1 || at < first)) first = at;
  }

  const start = first === -1 ? 0 : Math.max(0, first - radius);
  const end = first === -1 ? Math.min(text.length, radius * 2) : Math.min(text.length, first + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const window = prefix + text.slice(start, end) + suffix;
  const windowLower = window.toLowerCase();

  const marks: [number, number][] = [];
  for (const term of cleaned) {
    let at = windowLower.indexOf(term);
    while (at >= 0) {
      // Extend to the end of the word so a prefix match highlights the whole word.
      let wordEnd = at + term.length;
      while (wordEnd < window.length && /\w/.test(window[wordEnd])) wordEnd++;
      marks.push([at, wordEnd]);
      at = windowLower.indexOf(term, at + term.length);
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  return { text: window, marks };
}
