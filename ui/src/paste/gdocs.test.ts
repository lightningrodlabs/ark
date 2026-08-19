import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { htmlToMarkdown } from './gdocs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../../test/fixtures/gdocs');

describe('htmlToMarkdown', () => {
  it('converts Google Docs inline-CSS emphasis to markdown', () => {
    const html =
      '<b style="font-weight:normal" id="docs-internal-guid-abc">' +
      '<p><span style="font-weight:700">Treasurer</span> reported a ' +
      '<span style="font-style:italic">surplus</span>.</p></b>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('**Treasurer**');
    expect(md).toContain('*surplus*');
    expect(md).not.toContain('docs-internal-guid');
    expect(md).not.toContain('font-weight');
  });

  it('does not emit bold for the normal-weight wrapper Google Docs adds', () => {
    const html = '<b style="font-weight:normal"><p>Plain sentence.</p></b>';
    expect(htmlToMarkdown(html).trim()).toEqual('Plain sentence.');
  });

  it('keeps tables as GFM', () => {
    const html =
      '<table><tr><th>Item</th><th>Amount</th></tr><tr><td>Roof</td><td>$4,200</td></tr></table>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('| Item | Amount |');
    expect(md).toContain('| Roof | $4,200 |');
  });

  it('keeps lists and links', () => {
    const html = '<ul><li>Approved <a href="https://example.org/m">minutes</a></li></ul>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('-   Approved [minutes](https://example.org/m)'.replace(/ {3}/, ' '));
  });

  it('strips scripts, event handlers, and remote images', () => {
    const html =
      '<p onclick="steal()">Hi</p><script>steal()</script>' +
      '<img src="https://tracker.example/pixel.gif">';
    const md = htmlToMarkdown(html);
    expect(md).not.toContain('steal');
    expect(md).not.toContain('tracker.example');
    expect(md).toContain('Hi');
  });

  it('leaves plain text untouched', () => {
    expect(htmlToMarkdown('Just words.').trim()).toEqual('Just words.');
  });

  it('converts a realistic bold-<td> table to GFM, not a raw HTML blob', () => {
    // The corpus's Google Docs tables have no <th> at all, and
    // turndown-plugin-gfm silently keeps such a table as raw HTML. The
    // already-<th> unit test above passes either way, so only this one fails if
    // the header promotion regresses.
    const md = htmlToMarkdown(readFileSync(path.join(FIXTURES, 'gdocs-table.html'), 'utf8'));
    expect(md).not.toMatch(/<table/i);
    expect(md).not.toMatch(/<t[dhr]\b/i);
    expect(md).toMatch(/\|\s*---/);
  });

  it('produces span-free markdown for every real fixture', () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.html'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const md = htmlToMarkdown(readFileSync(path.join(FIXTURES, file), 'utf8'));
      expect(md, file).not.toMatch(/<span/i);
      expect(md, file).not.toMatch(/style=/i);
      expect(md.trim().length, file).toBeGreaterThan(0);
    }
  });
});
