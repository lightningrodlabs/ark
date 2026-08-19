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
