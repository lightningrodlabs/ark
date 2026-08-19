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

/**
 * Text-level semantics: elements that never start a new line, so prose either
 * side of one is a single run to the reader. Everything not named here counts
 * as a block, `br` included — it is phrasing content but it does break the
 * line, which is the only thing this list is about.
 *
 * An allowlist rather than a block list because DOMPurify's default allowlist
 * is wide and a body may contain raw HTML. The two errors are not equal: a
 * spurious break only loses a mark that straddles markup, while a missing
 * break invents a mark spanning two blocks over a word that exists in
 * neither. Unknown tags therefore fall on the block side.
 */
const INLINE = new Set([
  'a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'data', 'del', 'dfn', 'em',
  'font', 'i', 'img', 'ins', 'kbd', 'mark', 'nobr', 'picture', 'q', 'rp', 'rt', 'ruby', 's',
  'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr',
]);

/**
 * The document's text with its text nodes, and the offset each node starts at.
 *
 * Runs inside one block are concatenated with nothing between them, so a match
 * survives inline markup: `the <strong>well</strong> pump` reads as one run,
 * exactly as it looks on screen. Runs from different blocks get a newline
 * between them (see `blockOf`), because otherwise `<p>the well</p><p>pump
 * was…</p>` reads as
 * "wellpump" — a word in neither paragraph — and a search for "well" marks a
 * range starting in one paragraph and ending in the next.
 *
 * A newline specifically, and not a space: `\n` is not a word character, so it
 * ends a prefix match's run to word-end, and it is not the space a quoted
 * phrase would need, so no phrase can match across the join either. It is also
 * what separates these same blocks in the markdown source that `snippet()`
 * matches over, which keeps the two consistent.
 */
/**
 * The block a text node belongs to: its nearest ancestor that is not inline,
 * or `root` for text with no element between it and the top.
 *
 * Comparing these across consecutive text nodes catches a boundary in both
 * directions. Watching for block *elements* as the walk passes them would
 * only catch blocks being entered — nothing is visited between `</p>` and the
 * text after it, or between `</ul>` and the rest of the list item it sat in.
 */
function blockOf(node: Node, root: Node): Node {
  for (let el = node.parentNode; el && el !== root; el = el.parentNode) {
    if (el.nodeType === Node.ELEMENT_NODE && !INLINE.has((el as Element).tagName.toLowerCase())) {
      return el;
    }
  }
  return root;
}

function runsOf(root: Node): { runs: Run[]; text: string } {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const runs: Run[] = [];
  let text = '';
  let block: Node | null = null;
  // A <br> breaks the line without changing which block the text is in, so it
  // is the one boundary blockOf cannot see. Spent on the next text node, so no
  // separator is ever added before the first run or after the last.
  let pendingBreak = false;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).tagName.toLowerCase() === 'br') pendingBreak = true;
      continue;
    }
    const value = node.nodeValue ?? '';
    // Empty text nodes would give a range a start or end with nowhere to be.
    if (!value) continue;

    const own = blockOf(node, root);
    if (text && (pendingBreak || own !== block)) text += '\n';
    pendingBreak = false;
    block = own;

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
 * Text nodes are concatenated within a block and newline-separated across
 * blocks — see `runsOf`. No match can contain that newline (terms are
 * whitespace-split and a phrase's separator is a space), so every range still
 * begins and ends inside a real text node.
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
