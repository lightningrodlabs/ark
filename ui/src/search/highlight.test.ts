import { describe, expect, it } from 'vitest';
import { applyHighlight, highlightRanges, HIGHLIGHT_NAME } from './highlight';

function body(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('highlightRanges', () => {
  it('covers each match in the rendered text', () => {
    const el = body('<p>The treasurer reported.</p><p>The roof was fine.</p>');
    const ranges = highlightRanges(el, ['treasur', 'roof']);
    expect(ranges.map((r) => r.toString())).toEqual(['treasurer', 'roof']);
  });

  it('spans inline markup, because the reader sees one word', () => {
    const el = body('<p>the <strong>well</strong> pump</p>');
    const ranges = highlightRanges(el, ['well pump']);
    expect(ranges.map((r) => r.toString())).toEqual(['well pump']);
  });

  it('marks a shared prefix once rather than twice', () => {
    const el = body('<p>the budgets were approved</p>');
    expect(highlightRanges(el, ['budget', 'budgets']).map((r) => r.toString())).toEqual([
      'budgets',
    ]);
  });

  // A block boundary is a word boundary. Text nodes are concatenated to make
  // a match survive inline markup, but fusing two blocks invents words that
  // exist in neither — `<p>the well</p><p>pump…</p>` reading as "wellpump" —
  // and marks a range that starts in one paragraph and ends in the next.
  // Minutes are dense with short blocks, so this is common, not exotic.
  describe('block boundaries', () => {
    it('does not let a mark span two paragraphs', () => {
      const el = body('<p>the well</p><p>pump was replaced</p>');
      expect(highlightRanges(el, ['well']).map((r) => r.toString())).toEqual(['well']);
    });

    it('does not invent a match out of the junction between two blocks', () => {
      const el = body('<p>the wel</p><p>lpump was replaced</p>');
      expect(highlightRanges(el, ['well'])).toEqual([]);
    });

    it('does not match a phrase whose words straddle a block boundary', () => {
      const el = body('<p>the well</p><p>pump was replaced</p>');
      expect(highlightRanges(el, ['well pump'])).toEqual([]);
    });

    it('separates adjacent table cells', () => {
      const el = body('<table><tr><td>the well</td><td>pump</td></tr></table>');
      expect(highlightRanges(el, ['well']).map((r) => r.toString())).toEqual(['well']);
    });

    it('separates adjacent list items', () => {
      const el = body('<ul><li>the well</li><li>pump</li></ul>');
      expect(highlightRanges(el, ['well']).map((r) => r.toString())).toEqual(['well']);
    });

    it('separates a heading from the paragraph beneath it', () => {
      const el = body('<h2>the well</h2><p>pump was replaced</p>');
      expect(highlightRanges(el, ['well']).map((r) => r.toString())).toEqual(['well']);
    });

    it('separates at a line break, which breaks the line', () => {
      const el = body('<p>the well<br>pump was replaced</p>');
      expect(highlightRanges(el, ['well']).map((r) => r.toString())).toEqual(['well']);
    });

    // Leaving a block is as much a boundary as entering one, and there is no
    // element between the two text nodes to notice it at.
    it('separates text that follows a closed block', () => {
      const el = body('<div><p>the well</p>pump was replaced</div>');
      expect(highlightRanges(el, ['well']).map((r) => r.toString())).toEqual(['well']);
    });

    it('separates a nested list from the rest of its parent item', () => {
      const el = body('<ul><li><ul><li>the well</li></ul>pump was replaced</li></ul>');
      expect(highlightRanges(el, ['well']).map((r) => r.toString())).toEqual(['well']);
    });

    it('still fuses across inline markup within one block', () => {
      const el = body('<p>the <strong>well</strong> <em>pump</em> was replaced</p>');
      expect(highlightRanges(el, ['well pump']).map((r) => r.toString())).toEqual(['well pump']);
      expect(highlightRanges(el, ['wel']).map((r) => r.toString())).toEqual(['well']);
    });
  });

  it('produces nothing for no terms or no matches', () => {
    const el = body('<p>nothing to see</p>');
    expect(highlightRanges(el, [])).toEqual([]);
    expect(highlightRanges(el, ['absent'])).toEqual([]);
  });

  it('never touches the markup', () => {
    const html = '<p>The treasurer reported.</p>';
    const el = body(html);
    highlightRanges(el, ['treasurer']);
    expect(el.innerHTML).toEqual(html);
  });
});

describe('applyHighlight', () => {
  // jsdom has no CSS Custom Highlight API, which makes this environment the
  // degraded browser the feature detection exists for: it must return a
  // usable cleanup and mark nothing, rather than throw and take the document
  // view down with it.
  it('degrades quietly where CSS.highlights is missing', () => {
    const registry = (globalThis as { CSS?: { highlights?: unknown } }).CSS?.highlights;
    expect(registry).toBeUndefined();

    const el = body('<p>The treasurer reported.</p>');
    const cleanup = applyHighlight(el, ['treasurer']);
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });

  it('names the highlight the stylesheet styles', () => {
    expect(HIGHLIGHT_NAME).toBe('ark-search');
  });
});
