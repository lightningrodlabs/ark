import type { DocumentSummary } from '../src/types';

const COMMITTEES = [
  'Finance and Legal',
  'Membership, Outreach and Promotion',
  'Community Life',
  'Buildings and Land',
  'Monthly Meeting',
  'Buildings',
  'Land',
  'Called Meeting',
  'Emergency Response',
  'QIVP',
];

const VOCABULARY = (
  'minutes committee meeting attendance clerk treasurer budget roof well pump gutter ' +
  'approved deferred proposal discussion consensus season maintenance land building ' +
  'membership outreach promotion community life finance legal reserve fund quarterly ' +
  'report motion seconded carried abstained regrets present agenda item action follow'
).split(' ');

/** Deterministic PRNG so a failing perf run is reproducible. */
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Word-count formula calibrated against the reference corpus (1406 documents,
// 784,754 words total — an average of ~558 words/document): floor 72 plus a
// cubed-random tail up to 1800 gives this generator a total word count within
// 0.2% of that reference at seed 42, while keeping the "mostly short, a few
// long" shape a real committee archive has (annual reports and budget
// discussions run long; a one-line "meeting adjourned, no quorum" does not).
const WORD_COUNT_FLOOR = 72;
const WORD_COUNT_TAIL = 1800;

/**
 * Synthetic stand-in for the reference corpus: same document count, a
 * matching total word count (and so a matching total text volume for the
 * index to build over) and the same folder spread. Real minutes are a
 * community's private records and are never committed here.
 */
export function generateCorpus(count: number, seed: number): DocumentSummary[] {
  const random = mulberry32(seed);
  const docs: DocumentSummary[] = [];

  for (let i = 0; i < count; i++) {
    // Log-normal-ish: most documents short, a few very long.
    const words = Math.round(WORD_COUNT_FLOOR + Math.pow(random(), 3) * WORD_COUNT_TAIL);
    const paragraphs: string[] = [];
    let written = 0;
    while (written < words) {
      const length = 20 + Math.floor(random() * 60);
      const sentence = Array.from(
        { length },
        () => VOCABULARY[Math.floor(random() * VOCABULARY.length)],
      ).join(' ');
      paragraphs.push(sentence + '.');
      written += length;
    }

    const committee = COMMITTEES[Math.floor(random() * COMMITTEES.length)];
    const year = 2001 + Math.floor(random() * 26);
    const month = 1 + Math.floor(random() * 12);
    const day = 1 + Math.floor(random() * 28);
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    docs.push({
      original: new Uint8Array([i & 0xff, (i >> 8) & 0xff, 1]) as any,
      latest: new Uint8Array([i & 0xff, (i >> 8) & 0xff, 1]) as any,
      author: new Uint8Array([1, 1, Math.floor(random() * 10)]) as any,
      created_at: 0,
      updated_at: 0,
      body: `## Attendance\n\n${paragraphs.join('\n\n')}\n`,
      meta: { title: `${committee}, ${date}`, date },
    });
  }
  return docs;
}
