export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  excluded: string[];
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
  let combineWith: 'AND' | 'OR' = 'AND';

  const withoutPhrases = raw.replace(/"([^"]+)"/g, (_, phrase: string) => {
    const trimmed = phrase.trim();
    if (trimmed) {
      phrases.push(trimmed.toLowerCase());
      terms.push(...trimmed.toLowerCase().split(/\s+/));
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
    }
  }

  return { terms, phrases, excluded, combineWith };
}

/** Phrase adjacency and negation, which the index cannot express. */
export function matchesParsed(text: string, parsed: ParsedQuery): boolean {
  const haystack = text.toLowerCase();
  for (const phrase of parsed.phrases) {
    if (!haystack.includes(phrase)) return false;
  }
  for (const term of parsed.excluded) {
    if (haystack.includes(term)) return false;
  }
  return true;
}
