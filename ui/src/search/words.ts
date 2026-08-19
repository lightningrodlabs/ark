/**
 * What counts as a word, for everything in search that needs to know.
 *
 * One rule in one place: `matchesParsed` anchors quoted phrases and
 * exclusions at word boundaries, and `termRanges` extends a prefix match to
 * the end of the word it landed in. Those two answering differently is a
 * quiet failure — a document excluded on a word the highlight then marks a
 * different span of — so neither owns the definition.
 *
 * A word character is a Unicode letter, number, combining mark, or
 * underscore. Deliberately not `\w`, which is ASCII: this corpus has accented
 * names, and `\w` finds a boundary between "jos" and "é" — so a search for
 * the word Jos would claim a match in a document that only says José.
 *
 * Apostrophe and hyphen are NOT word characters. They separate, which is what
 * makes `"robin"` match "Robin's report" and `"jean"` match "Jean-Luc". The
 * cost is the other direction — `-o` excludes a document containing O'Brien —
 * and that trade is deliberate: possessives are everywhere in minutes and a
 * single letter as a query term is vanishingly rare.
 *
 * Whitespace, punctuation and symbols separate. So "Robinhawk" is one word,
 * which is the whole point.
 */

/** Anchored, so it tests one whole code point rather than searching a string. */
const WORD = /^[\p{L}\p{N}\p{M}_]$/u;

/** The code point starting at `index`, or '' past either end. */
function codePointAt(text: string, index: number): string {
  if (index < 0 || index >= text.length) return '';
  const cp = text.codePointAt(index);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/**
 * The code point ending immediately before `index`, or '' at the start.
 *
 * Stepping back one UTF-16 unit would land on the low half of a surrogate
 * pair and read an astral letter as a lone surrogate, which matches no
 * property and would look like a word boundary in the middle of a word.
 */
function codePointBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const prev = text.charCodeAt(index - 1);
  if (prev >= 0xdc00 && prev <= 0xdfff && index >= 2) {
    const before = text.charCodeAt(index - 2);
    if (before >= 0xd800 && before <= 0xdbff) return codePointAt(text, index - 2);
  }
  return codePointAt(text, index - 1);
}

/** Whether a word character starts at `index`. False past the end of the text. */
export function wordCharAt(text: string, index: number): boolean {
  return WORD.test(codePointAt(text, index));
}

/** Whether a word character ends at `index`. False at the start of the text. */
export function wordCharBefore(text: string, index: number): boolean {
  return WORD.test(codePointBefore(text, index));
}

/**
 * The offset at which the run of word characters starting at `from` ends —
 * `from` itself if there is none. What "extend a prefix match to the end of
 * the word" means: from the end of "treasur" this returns the end of
 * "treasurer".
 */
export function endOfWord(text: string, from: number): number {
  let at = from;
  while (at < text.length) {
    const ch = codePointAt(text, at);
    if (!WORD.test(ch)) break;
    at += ch.length;
  }
  return at;
}

/**
 * Whether `needle` occurs in `haystack` as a whole word rather than anywhere
 * inside one. Both are expected already lowercased by the caller — this does
 * no case folding of its own.
 *
 * A multi-word needle stays a phrase: the run has to be there verbatim,
 * anchored at each end, so "well pump" is not found inside "stairwell
 * pumpkin".
 *
 * The anchor is only required on a side where the needle's own edge is a word
 * character. A needle that already begins or ends with punctuation carries
 * its boundary with it, and demanding a second one there would make it
 * unmatchable.
 */
export function includesWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const anchorStart = wordCharAt(needle, 0);
  const anchorEnd = wordCharBefore(needle, needle.length);

  // Advancing by one rather than by the needle's length so overlapping
  // occurrences are all considered: the first one found may be mid-word while
  // a later, overlapping one is not.
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    if (anchorStart && wordCharBefore(haystack, at)) continue;
    if (anchorEnd && wordCharAt(haystack, at + needle.length)) continue;
    return true;
  }
  return false;
}
