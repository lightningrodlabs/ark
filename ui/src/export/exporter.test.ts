import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { encodeHashToBase64 } from '@holochain/client';
import {
  buildArchive,
  documentFileName,
  planExport,
  serializeDocument,
  UNFILED_DIR,
} from './exporter';
import { parseFrontMatter } from '../import/frontmatter';
import { matchAttachments, planImport } from '../import/importer';
import type { DocumentSummary, Folder } from '../types';

// Invented content throughout. Nothing here comes from the archive ark is
// replacing — only the SHAPES that archive has: committee folders with a year
// beneath them, punctuation and accents in titles, per-record Drupal ids, and
// metadata keys nobody promised in advance.
const folders: Folder[] = [
  { id: 'fnl', name: 'Finance and Legal', parent: null, order: 0, deleted: false },
  { id: 'fnl-2014', name: '2014', parent: 'fnl', order: 0, deleted: false },
  { id: 'life', name: 'Community Life', parent: null, order: 1, deleted: false },
];

let counter = 0;
const hash = (): Uint8Array => {
  counter += 1;
  const bytes = new Uint8Array(39);
  new DataView(bytes.buffer).setUint32(0, counter);
  return bytes;
};

function doc(meta: Record<string, string>, body: string, amended = false): DocumentSummary {
  const original = hash();
  return {
    original: original as any,
    latest: (amended ? hash() : original) as any,
    author: hash() as any,
    created_at: 1_600_000_000,
    updated_at: amended ? 1_700_000_000 : 1_600_000_000,
    body,
    meta,
  };
}

/** The same base64 key the document store uses, without importing a rune module. */
const k = (d: DocumentSummary) => encodeHashToBase64(d.original);

describe('planExport', () => {
  it('lays documents out under their folder path, unfiled ones under _unfiled', () => {
    const filed = doc({ title: 'Quarterly review' }, 'body');
    const loose = doc({ title: 'Stray note' }, 'body');
    const plan = planExport({
      documents: [filed, loose],
      folders,
      filings: new Map([
        [k(filed), 'fnl-2014'],
        [k(loose), null],
      ]),
      trashed: new Set(),
    });

    expect(plan.map((p) => p.path)).toEqual([
      'Finance and Legal/2014/Quarterly review.md',
      `${UNFILED_DIR}/Stray note.md`,
    ]);
  });

  it('leaves trashed documents out entirely', () => {
    const kept = doc({ title: 'Kept' }, 'body');
    const binned = doc({ title: 'Binned' }, 'body');
    const plan = planExport({
      documents: [kept, binned],
      folders,
      filings: new Map([
        [k(kept), 'life'],
        [k(binned), 'life'],
      ]),
      trashed: new Set([k(binned)]),
    });

    expect(plan.map((p) => p.path)).toEqual(['Community Life/Kept.md']);
  });

  it('disambiguates two documents with the same title in one directory', () => {
    const first = doc({ title: 'Special meeting', date: '2014-03-04' }, 'first');
    const second = doc({ title: 'Special meeting', date: '2014-03-04' }, 'second');
    const plan = planExport({
      documents: [first, second],
      folders,
      filings: new Map([
        [k(first), 'fnl-2014'],
        [k(second), 'fnl-2014'],
      ]),
      trashed: new Set(),
    });

    expect(plan.map((p) => p.path)).toEqual([
      'Finance and Legal/2014/Special meeting.md',
      'Finance and Legal/2014/Special meeting (2).md',
    ]);
  });

  it('keeps the same title in two different directories at its own name', () => {
    const a = doc({ title: 'Annual budget' }, 'a');
    const b = doc({ title: 'Annual budget' }, 'b');
    const plan = planExport({
      documents: [a, b],
      folders,
      filings: new Map([
        [k(a), 'fnl-2014'],
        [k(b), 'life'],
      ]),
      trashed: new Set(),
    });

    expect(plan.map((p) => p.path)).toEqual([
      'Finance and Legal/2014/Annual budget.md',
      'Community Life/Annual budget.md',
    ]);
  });
});

describe('documentFileName', () => {
  it('keeps unicode and ordinary punctuation', () => {
    expect(documentFileName('Café “budget” — 2014')).toEqual('Café “budget” — 2014.md');
  });

  it('replaces characters no filesystem accepts', () => {
    expect(documentFileName('Minutes: 3/4 of a quorum?')).toEqual('Minutes- 3-4 of a quorum-.md');
  });

  it('falls back rather than producing a nameless file', () => {
    expect(documentFileName('   ')).toEqual('untitled.md');
  });
});

describe('serializeDocument', () => {
  it('round-trips every metadata value through the import parser', () => {
    const meta = {
      title: 'Board Minutes: 2014-03-04',
      date: '2014-03-04',
      committee: 'Finance and Legal',
      drupal_node: '1802',
      // Extensible by design: an unforeseen key must survive untouched.
      recorded_by: 'A. Nonymous',
      // Values YAML would otherwise reinterpret as a date, a number or a bool.
      quorum: 'yes',
      present: '12',
    };
    const body = '## Agenda\n\nThe treasurer presented the budget.\n';
    const parsed = parseFrontMatter(serializeDocument(meta, body));
    expect(parsed.meta).toEqual(meta);
    expect(parsed.body).toEqual(body);
  });
});

describe('buildArchive round trip', () => {
  it('survives export, unzip and re-import with folders, metadata and attachments intact', async () => {
    const minutes = doc(
      {
        title: 'Café budget review: “Q1” & beyond',
        date: '2014-03-04',
        committee: 'Finance and Legal',
        drupal_node: '1802',
        recorded_by: 'A. Nonymous',
      },
      '## Agenda\n\n- Budget\n- Roof repair\n',
    );
    const other = doc(
      { title: 'Special meeting', date: '2014-05-06', committee: 'Finance and Legal' },
      'Second document filed in the same year.',
    );
    const loose = doc({ title: 'Unsorted note', date: '2015-01-01' }, 'Filed nowhere.');
    const binned = doc({ title: 'Withdrawn draft' }, 'Should not appear.');
    const amended = doc({ title: 'Amended minutes', date: '2016-02-03' }, 'Current text.', true);

    const attachment = { name: 'budget.csv', bytes: new TextEncoder().encode('item,amount\nroof,120\n') };
    const attachmentsOf = vi.fn(async (d: DocumentSummary) =>
      d === minutes ? [attachment] : [],
    );
    const versionsOf = vi.fn(async () => 3);

    const result = await buildArchive(
      {
        documents: [minutes, other, loose, binned, amended],
        folders,
        filings: new Map([
          [k(minutes), 'fnl-2014'],
          [k(other), 'fnl-2014'],
          [k(loose), null],
          [k(binned), 'fnl-2014'],
          [k(amended), 'life'],
        ]),
        trashed: new Set([k(binned)]),
      },
      { attachmentsOf, versionsOf },
    );

    expect(result.documents).toEqual(4);
    expect(result.attachments).toEqual(1);
    expect(result.failed).toEqual([]);
    expect(result.bytes.length).toBeGreaterThan(0);

    const unzipped = unzipSync(result.bytes);
    const paths = Object.keys(unzipped).sort();
    expect(paths).toEqual([
      'Community Life/Amended minutes.md',
      'Finance and Legal/2014/Café budget review- “Q1” & beyond.md',
      'Finance and Legal/2014/budget.csv',
      'Finance and Legal/2014/Special meeting.md',
      `${UNFILED_DIR}/Unsorted note.md`,
    ].sort());
    // A trashed document leaves nothing behind, not even an empty file.
    expect(paths.some((p) => p.includes('Withdrawn'))).toBe(false);

    // Now read the export back the way ImportPanel would: markdown files as
    // ImportFiles, everything else as attachment candidates.
    const mdFiles = paths
      .filter((p) => p.endsWith('.md'))
      .map((p) => ({ name: p, text: strFromU8(unzipped[p]) }));
    const candidates = paths
      .filter((p) => !p.endsWith('.md'))
      .map((p) => ({ name: p, file: new File([unzipped[p]], p.split('/').pop()!) }));

    const plan = planImport(mdFiles, [], []);
    expect(plan.create).toHaveLength(4);

    const back = plan.create.find((p) => p.title.startsWith('Café'))!;
    expect(back.folderPath).toEqual('Finance and Legal/2014');
    expect(back.date).toEqual('2014-03-04');
    expect(back.import_id).toEqual('drupal:1802');
    expect(back.body).toEqual('## Agenda\n\n- Budget\n- Roof repair\n');

    // Every metadata key, not just the ones the importer itself reads.
    const reparsed = parseFrontMatter(
      mdFiles.find((f) => f.name.includes('Café'))!.text,
    ).meta;
    expect(reparsed).toMatchObject({
      title: 'Café budget review: “Q1” & beyond',
      date: '2014-03-04',
      committee: 'Finance and Legal',
      drupal_node: '1802',
      recorded_by: 'A. Nonymous',
      folder: 'Finance and Legal/2014',
    });

    // Prior versions are recorded rather than silently dropped.
    const amendedText = mdFiles.find((f) => f.name.includes('Amended'))!.text;
    expect(parseFrontMatter(amendedText).meta.prior_versions).toEqual('2');
    expect(versionsOf).toHaveBeenCalledTimes(1);

    // The unfiled document comes back unfiled, not invented into a folder.
    // Export omits `folder:` for it, so an import that defaulted to a folder
    // name here would quietly file every unfiled document on a round trip.
    const unfiled = plan.create.find((p) => p.title === 'Unsorted note')!;
    expect(unfiled.folderPath).toEqual('');
    expect(plan.newFolders).not.toContain('Unfiled');

    // The attachment attaches to the document it was written beside.
    const matched = matchAttachments(plan.create, candidates);
    expect(matched.unmatched).toEqual([]);
    expect(matched.byImportId.get(back.import_id)).toHaveLength(1);
    expect(matched.byImportId.get(back.import_id)![0].name).toEqual('budget.csv');
  });

  it('reports progress and never silently truncates a large corpus', async () => {
    const documents = Array.from({ length: 250 }, (_, i) =>
      doc({ title: `Minutes ${i}`, date: '2020-01-01' }, `Body ${i}`),
    );
    const seen: number[] = [];
    const result = await buildArchive(
      {
        documents,
        folders,
        filings: new Map(documents.map((d) => [k(d), 'life'] as const)),
        trashed: new Set(),
      },
      { onProgress: (done) => seen.push(done) },
    );

    expect(result.documents).toEqual(250);
    expect(Object.keys(unzipSync(result.bytes))).toHaveLength(250);
    expect(seen.at(-1)).toEqual(250);
    expect(seen.length).toBeGreaterThan(1);
  });

  it("keeps going when one document's attachment cannot be read", async () => {
    const a = doc({ title: 'Has a bad attachment' }, 'body');
    const b = doc({ title: 'Fine' }, 'body');
    const result = await buildArchive(
      {
        documents: [a, b],
        folders,
        filings: new Map([
          [k(a), 'life'],
          [k(b), 'life'],
        ]),
        trashed: new Set(),
      },
      {
        attachmentsOf: async (d) => {
          if (d === a) throw new Error('chunk missing');
          return [];
        },
      },
    );

    expect(result.documents).toEqual(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toContain('Has a bad attachment');
    expect(Object.keys(unzipSync(result.bytes))).toHaveLength(2);
  });
});
