import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from './frontmatter';

const sample = `---
title: "Finance and Legal Committee Minutes: 8/12/2026"
committee: Finance and Legal
meeting_date: 2026-08-12
drupal_node: 1802
---

## Attendance

Alice, Bob.
`;

describe('parseFrontMatter', () => {
  it('reads keys and returns the body without the fence', () => {
    const { meta, body } = parseFrontMatter(sample);
    expect(meta.committee).toEqual('Finance and Legal');
    expect(meta.meeting_date).toEqual('2026-08-12');
    expect(meta.drupal_node).toEqual('1802');
    expect(body.trim().startsWith('## Attendance')).toBe(true);
  });

  it('keeps quoted titles containing colons intact', () => {
    const { meta } = parseFrontMatter(sample);
    expect(meta.title).toEqual('Finance and Legal Committee Minutes: 8/12/2026');
  });

  it('treats a file with no front matter as all body', () => {
    const { meta, body } = parseFrontMatter('# Just a heading\n\ntext');
    expect(meta).toEqual({});
    expect(body).toEqual('# Just a heading\n\ntext');
  });

  it('does not treat a horizontal rule mid-document as front matter', () => {
    const { meta, body } = parseFrontMatter('text\n\n---\n\nmore text');
    expect(meta).toEqual({});
    expect(body).toContain('more text');
  });

  it('stringifies non-string scalars', () => {
    const { meta } = parseFrontMatter('---\ncount: 3\nflag: true\n---\nbody');
    expect(meta.count).toEqual('3');
    expect(meta.flag).toEqual('true');
  });
});
