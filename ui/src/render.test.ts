import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render';

describe('renderMarkdown', () => {
  it('renders ordinary markdown', () => {
    const out = renderMarkdown('## Attendance\n\nAlice and **Bob**.');
    expect(out).toContain('<h2');
    expect(out).toContain('<strong>Bob</strong>');
  });

  it('strips a script tag from a document body', () => {
    const out = renderMarkdown('Minutes\n\n<script>steal()</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('steal');
    expect(out).toContain('Minutes');
  });

  it('strips inline event handlers', () => {
    expect(renderMarkdown('<img src=x onerror="steal()">')).not.toMatch(/onerror/i);
  });

  it('strips javascript: urls', () => {
    expect(renderMarkdown('[click](javascript:steal())')).not.toMatch(/javascript:/i);
  });

  it('returns a string, never a stringified promise', () => {
    // If `marked.parse`'s async:false ever regressed to a Promise, the cast in
    // renderMarkdown would hide it and DOMPurify would sanitize the harmless
    // string "[object Promise]" — every document body would render empty with
    // the whole suite still green.
    const out = renderMarkdown('# Heading');
    expect(typeof out).toEqual('string');
    expect(out).not.toContain('Promise');
    expect(out).toContain('Heading');
  });
});
