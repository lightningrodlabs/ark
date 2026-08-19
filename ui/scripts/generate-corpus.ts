import type { DocumentSummary } from '../src/types';

// Invented names, not the community's actual committee structure — same count
// and a similar name-length spread to the real list, which is what the perf
// corpus needs (see generateCorpus below), but nothing here identifies the
// organisation this tool was built for.
const COMMITTEES = [
  'Budget and Records',
  'Fellowship, Outreach and Growth',
  'Community Care',
  'Grounds and Property',
  'Regular Gathering',
  'Facilities',
  'Trust',
  'Special Session',
  'Crisis Response',
  'YFLC',
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

const WORD_COUNT_FLOOR = 72;
const WORD_COUNT_TAIL = 1800;

/**
 * Synthetic stand-in for the reference corpus: same document count, a total
 * word count within about 2% of it (and so a comparable total text volume
 * for the index to build over) and the same folder spread. Real minutes are
 * a community's private records and are never committed here.
 */
export function generateCorpus(count: number, seed: number): DocumentSummary[] {
  const random = mulberry32(seed);
  const docs: DocumentSummary[] = [];

  for (let i = 0; i < count; i++) {
    // Log-normal-ish: most documents small, a few very large. Constants are
    // calibrated against the reference corpus's actual totals (784,754 words
    // over 1406 documents, ~560 each), not guessed — an earlier pair produced a
    // corpus 3.3x too wordy, which would have measured the wrong workload.
    // At seed 42 this emits 770,459 words, 1.8% under the reference. Close
    // enough that the measured margins mean what they say; stated exactly so a
    // later reader can trust this as the calibration record.
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
