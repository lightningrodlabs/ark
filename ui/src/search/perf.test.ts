import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { ArkIndex } from './index';
import { generateCorpus } from '../../scripts/generate-corpus';
import { parseFrontMatter } from '../import/frontmatter';
import type { DocumentSummary, Folder } from '../types';

/** The reference workload: 1406 meeting records, 784,754 words, ~5 MB. */
const CORPUS_SIZE = 1406;
const BUILD_BUDGET_MS = 5000;
const QUERY_BUDGET_MS = 100;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.md') ? [full] : [];
  });
}

/**
 * CI always runs on generated text. Setting ARK_CORPUS_DIR points the same
 * budgets at a real archive locally — the community's minutes never enter this
 * repository.
 */
function corpus(): DocumentSummary[] {
  const dir = process.env.ARK_CORPUS_DIR;
  if (!dir) return generateCorpus(CORPUS_SIZE, 42);
  return walk(dir).map((file, i) => {
    const { meta, body } = parseFrontMatter(readFileSync(file, 'utf8'));
    return {
      original: new Uint8Array([i & 0xff, (i >> 8) & 0xff, 1]) as any,
      latest: new Uint8Array([i & 0xff, (i >> 8) & 0xff, 1]) as any,
      author: new Uint8Array([1, 1, 1]) as any,
      created_at: 0,
      updated_at: 0,
      body,
      meta: { title: meta.title ?? path.basename(file), date: meta.meeting_date ?? '' },
    };
  });
}

const folders: Folder[] = [];
const filters = {
  folderId: null,
  folders,
  from: null,
  to: null,
  author: null,
  includeTrashed: false,
};

describe('search performance at corpus scale', () => {
  const docs = corpus();

  it('has a corpus of the expected shape', () => {
    expect(docs.length).toBeGreaterThanOrEqual(1000);
    const chars = docs.reduce((sum, d) => sum + d.body.length, 0);
    expect(chars).toBeGreaterThan(3_000_000);
  });

  it(`builds the index in under ${BUILD_BUDGET_MS}ms`, () => {
    const index = new ArkIndex();
    const start = performance.now();
    index.rebuild(docs);
    const elapsed = performance.now() - start;
    console.log(`index build: ${Math.round(elapsed)}ms for ${docs.length} documents`);
    expect(elapsed).toBeLessThan(BUILD_BUDGET_MS);
  });

  it(`answers each query in under ${QUERY_BUDGET_MS}ms`, () => {
    const index = new ArkIndex();
    index.rebuild(docs);
    const queries = ['budget', 'roof repair', '"well pump"', 'treasur', 'minutes -draft'];
    for (const query of queries) {
      const start = performance.now();
      const hits = index.search(query, filters);
      const elapsed = performance.now() - start;
      console.log(`query ${JSON.stringify(query)}: ${Math.round(elapsed)}ms, ${hits.length} hits`);
      expect(elapsed, query).toBeLessThan(QUERY_BUDGET_MS);
    }
  });

  it('indexes page by page for about what one rebuild costs, with a small tail', () => {
    // The number that matters is not the total — the same words get indexed
    // either way — but WHERE it is spent. Rebuilding at the end of the load
    // puts all of it after the last page arrives, as one synchronous block on
    // the main thread at the moment the app looks ready. Indexing each page as
    // it lands spends it between round trips instead, and what is left after
    // the last page is one page's worth.
    const page = 100;
    const rebuildIndex = new ArkIndex();
    const rebuildStart = performance.now();
    rebuildIndex.rebuild(docs);
    const rebuildMs = performance.now() - rebuildStart;

    const index = new ArkIndex();
    const perPage: number[] = [];
    for (let offset = 0; offset < docs.length; offset += page) {
      const start = performance.now();
      index.upsertAll(docs.slice(offset, offset + page));
      perPage.push(performance.now() - start);
    }
    const incrementalMs = perPage.reduce((a, b) => a + b, 0);
    const tailMs = perPage[perPage.length - 1];
    console.log(
      `rebuild at end: ${Math.round(rebuildMs)}ms all after the last page; ` +
        `incremental: ${Math.round(incrementalMs)}ms total over ${perPage.length} pages, ` +
        `${Math.round(tailMs)}ms of it after the last page`,
    );

    // Total cost must not have run away: the same corpus, indexed once.
    expect(incrementalMs).toBeLessThan(rebuildMs * 2);
    // And the blocking tail — the part the user waits through — is a page, not
    // an archive.
    expect(tailMs).toBeLessThan(rebuildMs / 4);
  });

  it('adds one document incrementally without a rebuild', () => {
    const index = new ArkIndex();
    index.rebuild(docs);
    const start = performance.now();
    index.upsert({ ...docs[0], original: new Uint8Array([9, 9, 9]) as any, body: 'a new record' });
    expect(performance.now() - start).toBeLessThan(50);
  });
});
