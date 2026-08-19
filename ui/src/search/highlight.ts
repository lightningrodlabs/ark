import { mergeRanges, termRanges } from './terms';

/**
 * Marking the search terms inside an opened document.
 *
 * Done with the CSS Custom Highlight API — `Range`s registered under a name
 * and styled by `::highlight()` in app.css — and deliberately NOT by wrapping
 * matches in `<mark>`. Document bodies are rendered through
 * `renderMarkdown` (DOMPurify) and nothing else in this app may produce HTML
 * for `{@html}`; anyone in the group can write a body, so building markup
 * outside that boundary is how the XSS this project already fixed once comes
 * back. Highlight ranges style text nodes that DOMPurify has already
 * sanitised and never touch the markup at all, so the boundary stays put.
 *
 * The API is in Chromium 105+ and Electron 32 ships 128, but it is
 * feature-detected regardless: a browser without it gets no highlighting
 * rather than a broken document.
 */

/** The registry key, also the `::highlight()` name styled in app.css. */
export const HIGHLIGHT_NAME = 'ark-search';

// lib.dom types HighlightRegistry with only `forEach`; its setlike `set` and
// `delete` are missing. A narrow local shape rather than a blanket `any`.
type Registry = {
  set(name: string, highlight: Highlight): void;
  delete(name: string): void;
};

function registry(): Registry | undefined {
  const css = (globalThis as { CSS?: { highlights?: unknown } }).CSS;
  const highlights = css?.highlights as Registry | undefined;
  if (!highlights || typeof Highlight === 'undefined') return undefined;
  return highlights;
}

interface Run {
  node: Text;
  /** Offset at which this node's text begins in the concatenation of all of them. */
  start: number;
}

function runsOf(root: Node): { runs: Run[]; text: string } {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs: Run[] = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? '';
    // Empty text nodes would give a range a start or end with nowhere to be.
    if (!value) continue;
    runs.push({ node: node as Text, start: text.length });
    text += value;
  }
  return { runs, text };
}

/** The run containing `offset`, and where in it. `atEnd` lets a range finish
 * exactly at a node's last character rather than spilling into the next. */
function locate(runs: Run[], offset: number, atEnd: boolean): { node: Text; offset: number } | null {
  for (const run of runs) {
    const end = run.start + run.node.length;
    if (offset < end || (atEnd && offset === end)) {
      return { node: run.node, offset: Math.max(0, offset - run.start) };
    }
  }
  return null;
}

/**
 * Ranges over `root`'s text covering every occurrence of `terms`.
 *
 * The text of every text node is concatenated, so a match survives being
 * split across inline markup (`the **well** pump`) — the same words a reader
 * sees as one run.
 */
export function highlightRanges(root: Node, terms: string[]): Range[] {
  const { runs, text } = runsOf(root);
  if (runs.length === 0) return [];
  const doc = root.ownerDocument ?? (root as Document);

  const ranges: Range[] = [];
  for (const [start, end] of mergeRanges(termRanges(text, terms))) {
    const from = locate(runs, start, false);
    const to = locate(runs, end, true);
    if (!from || !to) continue;
    const range = doc.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    ranges.push(range);
  }
  return ranges;
}

/**
 * Mark `terms` inside `root`, replacing whatever was marked before, and
 * return a cleanup that clears the marks again — the shape a Svelte `$effect`
 * wants. No terms, no root, or no Custom Highlight API all mean the same
 * thing: nothing is marked and nothing throws.
 */
export function applyHighlight(root: Node | null | undefined, terms: string[]): () => void {
  const highlights = registry();
  if (!highlights) return () => {};

  const clear = () => highlights.delete(HIGHLIGHT_NAME);
  clear();
  if (!root || terms.length === 0) return clear;

  const ranges = highlightRanges(root, terms);
  if (ranges.length > 0) highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  return clear;
}
