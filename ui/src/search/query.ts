import { includesWord } from './words';

export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  excluded: string[];
  /**
   * The literal strings worth marking wherever a match is shown to the user
   * — result snippets and the opened document alike.
   *
   * Not the same list as `terms`: a quoted phrase contributes the whole
   * phrase and not its words, because a phrase matched as a phrase and
   * lighting up each word separately would claim matches the search never
   * made. Exclusions are absent by construction — `-draft` is a reason a
   * document is NOT in the results, never something to point at inside one.
   */
  highlight: string[];
  combineWith: 'AND' | 'OR';
}

/**
 * MiniSearch gives prefix, fuzzy and AND/OR, but not quoted phrases or
 * negation. This parser produces a term set for MiniSearch plus the phrase and
 * exclusion lists that `matchesParsed` applies as a post-filter.
 */
export function parseQuery(raw: string): ParsedQuery {
  const phrases: string[] = [];
  const excluded: string[] = [];
  const terms: string[] = [];
  const highlight: string[] = [];
  let combineWith: 'AND' | 'OR' = 'AND';

  const withoutPhrases = raw.replace(/"([^"]+)"/g, (_, phrase: string) => {
    const trimmed = phrase.trim();
    if (trimmed) {
      phrases.push(trimmed.toLowerCase());
      // The index cannot express adjacency, so the phrase's words go in as
      // ordinary terms and `matchesParsed` enforces the phrase afterwards.
      // Highlighting, which has the whole text in hand, needs no such
      // approximation and marks the phrase itself.
      terms.push(...trimmed.toLowerCase().split(/\s+/));
      highlight.push(trimmed.toLowerCase());
    }
    return ' ';
  });

  const tokens = withoutPhrases.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'OR') {
      combineWith = 'OR';
    } else if (token === 'AND') {
      // default; nothing to do
    } else if (token === 'NOT') {
      const next = tokens[++i];
      if (next) excluded.push(next.toLowerCase());
    } else if (token.startsWith('-') && token.length > 1) {
      excluded.push(token.slice(1).toLowerCase());
    } else {
      terms.push(token.toLowerCase());
      highlight.push(token.toLowerCase());
    }
  }

  return { terms, phrases, excluded, highlight, combineWith };
}

/**
 * Phrase adjacency and negation, which the index cannot express.
 *
 * Both are matched as whole words (see `./words`), and that is the entire
 * difference between them and a bare term. A bare term goes to MiniSearch and
 * is prefix- and fuzzy-matched — `financ` finds financial, finance and
 * financing, and `eric` finds Robinhawk. That is the useful default and it is
 * untouched here, because bare terms are in `parsed.terms` and this function
 * never looks at them. Quoting a term or excluding it is how you ask for the
 * word itself, and before this was anchored there was no way to ask at all.
 */
export function matchesParsed(text: string, parsed: ParsedQuery): boolean {
  const haystack = text.toLowerCase();
  for (const phrase of parsed.phrases) {
    if (!includesWord(haystack, phrase)) return false;
  }
  for (const term of parsed.excluded) {
    if (includesWord(haystack, term)) return false;
  }
  return true;
}
